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
        // Silver detected! Return 80% of max 1023 (approx 818)
        // User requirement: Black(10) << White(700) < Silver(818)
        return 818;
    }

    // Grayscale: (R+G+B)/3
    const avg = (r + g + b) / 3;

    // Standard Sensor Logic often depends on the circuit (Pull-up vs Pull-down).
    // User reported "Inverted" behavior with current logic (Black=1023, White=0).
    // Switching to Reflectance Model:
    // White (High Reflection) -> High Value (~1023)
    // Black (Low Reflection) -> Low Value (~0)

    // Scale 0-255 to 10-700
    // Linear interpolation: y = y1 + (x - x1) * (y2 - y1) / (x2 - x1)
    // x=avg, x1=0, y1=10, x2=255, y2=700
    // y = 10 + avg * (690 / 255)
    return Math.floor(10 + avg * (690 / 255));
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
