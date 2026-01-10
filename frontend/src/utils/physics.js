import { ROBOT_CONFIG } from '../config/robotConfig';

export const updateRobotPhysics = (robot) => {
    const { leftSpeed, rightSpeed, angle } = robot;
    const { maxSpeed } = ROBOT_CONFIG.physics;
    const { base } = ROBOT_CONFIG.wheels;

    // Scale -100 to 100 range to pixels/frame
    const vL = (leftSpeed / 100) * maxSpeed;
    const vR = (rightSpeed / 100) * maxSpeed;

    const v = (vL + vR) / 2; // Linear velocity
    const omega = (vR - vL) / base; // Angular velocity

    return {
        ...robot,
        x: robot.x + v * Math.cos(angle),
        y: robot.y + v * Math.sin(angle),
        angle: robot.angle + omega
    };
};
