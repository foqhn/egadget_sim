/**
 * Detects sensor value from the canvas context.
 * @param {CanvasRenderingContext2D} ctx 
 * @param {number} x World x
 * @param {number} y World y
 * @returns {number} Sensor value 0 (white) to 1023 (black)
 */
export const readSensorValue = (ctx, x, y) => {
    if (x < 0 || x >= ctx.canvas.width || y < 0 || y >= ctx.canvas.height) return 0;

    // Read 1x1 pixel
    const pixel = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    const r = pixel[0];
    const g = pixel[1];
    const b = pixel[2];

    // Detect "Silver" (RGB: 192, 192, 192)
    // We allow a small tolerance in case of anti-aliasing or slight rendering diffs
    // Target: #C0C0C0 -> 192
    if (Math.abs(r - 192) < 10 && Math.abs(g - 192) < 10 && Math.abs(b - 192) < 10) {
        // Silver detected! Return 80% of max (1023 * 0.8 approx 818)
        return 818;
    }

    // Grayscale: (R+G+B)/3
    // White(255) -> 0, Black(0) -> 1023
    const avg = (r + g + b) / 3;

    // Invert: 255 becomes 0, 0 becomes 255. Then map to 0-1023.
    // 255 * 4 = 1020 approx 1023.
    return Math.floor((255 - avg) * 4);
};

/**
 * Calculates global position for a sensor based on robot state and config
 */
export const calculateSensorPosition = (robot, sensorConfig) => {
    const theta = robot.angle + sensorConfig.angle;
    return {
        x: robot.x + Math.cos(theta) * sensorConfig.distance,
        y: robot.y + Math.sin(theta) * sensorConfig.distance
    };
};
