const PIXELS_PER_METER = 24;

export const fromKmhToPixels = (kmh: number) => {
    const metersPerSecond = kmh * 1000 / 3600;
    return metersPerSecond * PIXELS_PER_METER;
}

export const fromPixelsToKmh = (pixels: number) => {
    const metersPerSecond = pixels / PIXELS_PER_METER;
    return metersPerSecond * 3600 / 1000;
}

export const fromMetersToPixels = (meters: number) => meters * PIXELS_PER_METER;
export const fromPixelsToMeters = (pixels: number) => pixels / PIXELS_PER_METER;

export const fromCmToPixels = (cm: number) => (cm / 100) * PIXELS_PER_METER;
export const fromPixelsToCm = (pixels: number) => (pixels / PIXELS_PER_METER) * 100;

export const fromHkToKmh = (hk: number) => {

}
