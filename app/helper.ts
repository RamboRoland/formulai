const PIXELS_PER_METER = 12;

export const fromKmhToPixels = (kmh: number) => {
    const metersPerSecond = kmh * 1000 / 3600;
    return metersPerSecond * PIXELS_PER_METER;
}

export const fromPixelsToKmh = (pixels: number) => {
    const metersPerSecond = pixels / PIXELS_PER_METER;
    return metersPerSecond * 3600 / 1000;
}