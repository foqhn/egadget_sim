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

// Checks if a World coordinate point is inside any obstacle.
export const isPointInObstacle = (x, y, objects) => {
    if (!objects) return false;
    for (const obj of objects) {
        if (obj.isObstacle) {
            let px = x;
            let py = y;
            if (obj.angle) {
                let cx, cy;
                if (obj.type === 'ellipse') {
                    cx = obj.cx; cy = obj.cy;
                } else {
                    cx = obj.x + obj.w / 2; cy = obj.y + obj.h / 2;
                }
                const dx = px - cx;
                const dy = py - cy;
                const cos = Math.cos(-obj.angle);
                const sin = Math.sin(-obj.angle);
                px = cx + dx * cos - dy * sin;
                py = cy + dx * sin + dy * cos;
            }

            // Simplified geometric check
            if (obj.type === 'rect') {
                if (px >= obj.x && px <= obj.x + obj.w && py >= obj.y && py <= obj.y + obj.h) {
                    return true;
                }
            } else if (obj.type === 'ellipse') {
                const dx = px - obj.cx;
                const dy = py - obj.cy;
                if ((dx * dx) / (obj.rx * obj.rx) + (dy * dy) / (obj.ry * obj.ry) <= 1) {
                    return true;
                }
            }
        }
    }
    return false;
};

/**
 * Calculates IR intensity from all IR sources for a given sensor position and robot angle.
 */
export const calculateIrIntensity = (x, y, robotAngle, objects) => {
    let maxIntensity = 0;
    if (!objects) return 0;

    for (const obj of objects) {
        if (obj.isIrLight) {
            let cx, cy;
            if (obj.type === 'ellipse') {
                cx = obj.cx; cy = obj.cy;
            } else {
                cx = obj.x + obj.w / 2; cy = obj.y + obj.h / 2;
            }

            const dx = cx - x;
            const dy = cy - y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Angle from sensor to light source
            const angleToTarget = Math.atan2(dy, dx);

            // Difference from robot's forward vector
            let angleDiff = angleToTarget - robotAngle;
            // Normalize exactly between -PI and PI
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

            // Is the source in front of the robot? (|angleDiff| < PI/2)
            if (Math.abs(angleDiff) < Math.PI / 2) {
                const angularFactor = Math.cos(angleDiff); // 1.0 straight ahead, 0.0 at 90 deg

                // Distance attenuation (Example: max 1023, drops to 0 at 600 pixels)
                // The eGadget typically operates on a field. 600px gives a good range.
                const MAX_DIST = 600;
                let distanceFactor = 1.0 - (distance / MAX_DIST);
                if (distanceFactor < 0) distanceFactor = 0;

                const intensity = Math.floor(1023 * distanceFactor * angularFactor);
                if (intensity > maxIntensity) {
                    maxIntensity = intensity;
                }
            }
        }
    }
    return maxIntensity;
};
