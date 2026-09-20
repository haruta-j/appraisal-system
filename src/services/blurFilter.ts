import { BlurMode, BlurRegion, DetectionBox, DetectionSample } from '../types';

export interface BlurFilterInput {
  startTime: number;
  endTime: number;
  blurMode: BlurMode;
  blurRegion: BlurRegion | null;
  trackedSamples: DetectionSample[] | null;
}

interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PAD_RATIO = 0.15;
const MIN_PAD = 8;
const BLUR_STRENGTH = 20; // boxblur luma radius

function unionBox(boxes: DetectionBox[]): PixelRect {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function padAndClamp(rect: PixelRect, frameWidth: number, frameHeight: number): PixelRect {
  const padX = Math.max(MIN_PAD, rect.width * PAD_RATIO);
  const padY = Math.max(MIN_PAD, rect.height * PAD_RATIO);
  const x = Math.max(0, rect.x - padX);
  const y = Math.max(0, rect.y - padY);
  const width = Math.min(frameWidth - x, rect.width + padX * 2);
  const height = Math.min(frameHeight - y, rect.height + padY * 2);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function clampToBounds(value: number, max: number): number {
  return Math.min(Math.max(0, value), Math.max(0, max));
}

/** Builds a step-function ffmpeg expression: value holds constant until the next keyframe's time. */
function buildPiecewiseExpr(keyframes: Array<{ time: number; value: number }>): string {
  if (keyframes.length === 1) return String(keyframes[0].value);
  let expr = String(keyframes[keyframes.length - 1].value);
  for (let i = keyframes.length - 2; i >= 0; i--) {
    expr = `if(lt(t,${keyframes[i + 1].time.toFixed(3)}),${keyframes[i].value},${expr})`;
  }
  return expr;
}

/**
 * Appends filter_complex stages that blur each interval on top of `inputLabel`, returning
 * the label of the final blurred stream. Blur-only; cutting is handled separately.
 */
export function buildBlurFilterComplex(
  inputLabel: string,
  decisions: BlurFilterInput[],
  frameWidth: number,
  frameHeight: number
): { filters: string[]; outputLabel: string } {
  const filters: string[] = [];
  let current = inputLabel;

  decisions.forEach((decision, idx) => {
    const baseLabel = `${current}`;
    const splitA = `blursrc${idx}`;
    const splitB = `blurtap${idx}`;
    const blurredLabel = `blurred${idx}`;
    const nextLabel = `stage${idx}`;

    filters.push(`[${baseLabel}]split=2[${splitA}][${splitB}]`);

    let cropExpr: PixelRect;
    let xExpr: string;
    let yExpr: string;

    if (decision.blurMode === 'fixed' && decision.blurRegion) {
      const padded = padAndClamp(decision.blurRegion, frameWidth, frameHeight);
      cropExpr = padded;
      xExpr = String(padded.x);
      yExpr = String(padded.y);
    } else {
      const keyed = (decision.trackedSamples ?? [])
        .filter((s) => s.boxes.length > 0)
        .map((s) => ({ time: s.time, rect: padAndClamp(unionBox(s.boxes), frameWidth, frameHeight) }));

      if (keyed.length === 0) {
        // Should not happen (validated upstream); fall back to a no-op tiny region.
        keyed.push({ time: decision.startTime, rect: { x: 0, y: 0, width: 16, height: 16 } });
      }

      // Constant crop size (max over keyframes) so the crop output stays a fixed frame size;
      // only the position (x/y) tracks the detected region over time.
      const width = Math.min(frameWidth, Math.round(Math.max(...keyed.map((k) => k.rect.width))));
      const height = Math.min(frameHeight, Math.round(Math.max(...keyed.map((k) => k.rect.height))));

      const xKeyframes = keyed.map((k) => ({
        time: k.time,
        value: Math.round(clampToBounds(k.rect.x, frameWidth - width)),
      }));
      const yKeyframes = keyed.map((k) => ({
        time: k.time,
        value: Math.round(clampToBounds(k.rect.y, frameHeight - height)),
      }));

      cropExpr = { x: 0, y: 0, width, height };
      xExpr = buildPiecewiseExpr(xKeyframes);
      yExpr = buildPiecewiseExpr(yKeyframes);
    }

    filters.push(
      `[${splitB}]crop=${cropExpr.width}:${cropExpr.height}:${xExpr}:${yExpr},boxblur=${BLUR_STRENGTH}:${BLUR_STRENGTH / 2}[${blurredLabel}]`
    );
    filters.push(
      `[${splitA}][${blurredLabel}]overlay=x=${xExpr}:y=${yExpr}:enable='between(t,${decision.startTime.toFixed(3)},${decision.endTime.toFixed(3)})'[${nextLabel}]`
    );

    current = nextLabel;
  });

  return { filters, outputLabel: current };
}
