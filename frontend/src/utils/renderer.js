import { ROBOT_CONFIG } from '../config/robotConfig';

export const drawCourse = (ctx, width, height, objects) => {
    // Fill background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);

    if (!objects) return;

    objects.forEach(obj => {
        ctx.beginPath();
        if (obj.type === 'ellipse') {
            ctx.lineWidth = obj.strokeWidth || 10;
            ctx.lineCap = 'round';
            ctx.strokeStyle = obj.color || 'black';
            ctx.ellipse(obj.cx, obj.cy, obj.rx, obj.ry, 0, 0, 2 * Math.PI);
            ctx.stroke();
        } else if (obj.type === 'rect') {
            ctx.lineWidth = obj.strokeWidth || 10;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = obj.color || 'black';
            ctx.rect(obj.x, obj.y, obj.w, obj.h);
            ctx.stroke();
        } else if (obj.type === 'image' && obj.imgElement) {
            ctx.drawImage(obj.imgElement, obj.x, obj.y, obj.w, obj.h);
        }
    });
};

export const drawSelection = (ctx, obj) => {
    // Draw bounding box and handles
    // We need to import getBounds logic or duplicate slightly for rendering
    // Let's reproduce simple bbox logic here
    let x, y, w, h;
    if (obj.type === 'ellipse') {
        const sw = obj.strokeWidth || 10;
        x = obj.cx - obj.rx - sw / 2;
        y = obj.cy - obj.ry - sw / 2;
        w = (obj.rx * 2) + sw;
        h = (obj.ry * 2) + sw;
    } else {
        x = obj.x; y = obj.y; w = obj.w; h = obj.h;
    }

    ctx.save();
    ctx.strokeStyle = '#00aaff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(x, y, w, h);

    // Handles
    ctx.fillStyle = 'white';
    ctx.strokeStyle = '#00aaff';
    ctx.setLineDash([]);
    const handles = [
        { x: x, y: y }, { x: x + w, y: y },
        { x: x, y: y + h }, { x: x + w, y: y + h }
    ];
    handles.forEach(h => {
        ctx.fillRect(h.x - 5, h.y - 5, 10, 10);
        ctx.strokeRect(h.x - 5, h.y - 5, 10, 10);
    });
    ctx.restore();
};

export const drawRobot = (ctx, robot) => {
    const { x, y, angle } = robot;
    const { body, wheels, sensors } = ROBOT_CONFIG;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Draw Body
    ctx.fillStyle = body.color;
    ctx.fillRect(-body.width / 2, -body.height / 2, body.width, body.height);

    // Draw Wheels
    ctx.fillStyle = wheels.color;
    // Left Wheel
    ctx.fillRect(-wheels.length / 2, -wheels.base / 2 - wheels.width / 2, wheels.length, wheels.width);
    // Right Wheel
    ctx.fillRect(-wheels.length / 2, wheels.base / 2 - wheels.width / 2, wheels.length, wheels.width);

    // Direction Indicator (Triangle)
    ctx.fillStyle = 'yellow';
    ctx.beginPath();
    ctx.moveTo(body.width / 2, 0);
    ctx.lineTo(0, -5);
    ctx.lineTo(0, 5);
    ctx.fill();

    // Visualize Sensors (Relative positions)
    sensors.forEach(sensor => {
        // We need to calculate relative position again or pass it in. 
        // For drawing RELATIVE to robot context (easier):
        const sx = Math.cos(sensor.angle) * sensor.distance;
        const sy = Math.sin(sensor.angle) * sensor.distance;

        ctx.fillStyle = sensor.color;
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.restore();
};
