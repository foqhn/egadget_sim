import { ROBOT_CONFIG } from '../config/robotConfig';
import { isPointInObstacle } from './sensors';

export const updateRobotPhysics = (robot, objects) => {
    const { leftSpeed, rightSpeed, angle, x, y } = robot;
    const { maxSpeed } = ROBOT_CONFIG.physics;
    const { base } = ROBOT_CONFIG.wheels;
    const { body, touchSensors } = ROBOT_CONFIG;

    // Scale -100 to 100 range to pixels/frame
    const vL = (leftSpeed / 100) * maxSpeed;
    const vR = (rightSpeed / 100) * maxSpeed;

    const v = (vL + vR) / 2; // Linear velocity
    const omega = (vR - vL) / base; // Angular velocity

    let nextX = x + v * Math.cos(angle);
    let nextY = y + v * Math.sin(angle);
    let nextAngle = angle + omega;

    // Collision check points (4 corners + touch sensors)
    const w2 = body.width / 2;
    const h2 = body.height / 2;
    const points = [
        { dx: w2, dy: h2 },
        { dx: w2, dy: -h2 },
        { dx: -w2, dy: h2 },
        { dx: -w2, dy: -h2 }
    ];

    if (touchSensors) {
        touchSensors.forEach(ts => {
            points.push({
                dx: ts.distance * Math.cos(ts.angle),
                dy: ts.distance * Math.sin(ts.angle)
            });
        });
    }

    const checkCollision = (cx, cy, cAngle) => {
        if (!objects) return false;
        const cosA = Math.cos(cAngle);
        const sinA = Math.sin(cAngle);
        for (let pt of points) {
            const worldX = cx + pt.dx * cosA - pt.dy * sinA;
            const worldY = cy + pt.dx * sinA + pt.dy * cosA;
            if (isPointInObstacle(worldX, worldY, objects)) {
                return true;
            }
        }
        return false;
    };

    // Prevent clipping: If the new state collides, try partial updates
    if (checkCollision(nextX, nextY, nextAngle)) {
        if (!checkCollision(x, y, nextAngle)) {
            // Can rotate but not translate (e.g. hit wall head-on, can turn away)
            nextX = x;
            nextY = y;
        } else if (!checkCollision(nextX, nextY, angle)) {
            // Can translate but not rotate (rare, maybe sliding alongside)
            nextAngle = angle;
        } else {
            // Block both translation and rotation
            nextX = x;
            nextY = y;
            nextAngle = angle;
        }
    }

    return {
        ...robot,
        x: nextX,
        y: nextY,
        angle: nextAngle
    };
};
