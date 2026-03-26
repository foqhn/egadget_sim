export const ROBOT_CONFIG = {
    // Body Dimensions
    body: {
        width: 30,
        height: 30,
        color: '#3b82f6', // blue-500
    },
    // Wheel Configuration
    wheels: {
        base: 40, // Distance between wheels (pixels)
        width: 5,
        length: 24, // Visual length
        color: '#1f2937', // gray-800
    },
    // Physics Limits
    physics: {
        maxSpeed: 3.0, // Pixels per frame
    },
    // Sensor Configuration
    // id: C-code identifier (CNx)
    // angle: Offset in radians from straight ahead
    // distance: Distance from robot center in pixels
    sensors: [
        { id: 2, label: 'Center', angle: 0, distance: 10, color: 'red' },
        { id: 5, label: 'Left', angle: degreesToRadians(-60), distance: 15, color: 'blue' },
        { id: 6, label: 'Right', angle: degreesToRadians(60), distance: 15, color: 'green' }
    ],
    // Touch Sensors (Geometric Collision)
    touchSensors: [
        { id: 3, label: 'FrontLeft(CN3)', angle: degreesToRadians(-40), distance: 25, color: 'orange', width: 4, height: 20 },
        { id: 4, label: 'FrontRight(CN4)', angle: degreesToRadians(40), distance: 25, color: 'orange', width: 4, height: 20 }
    ],
    // IR Sensors
    irSensors: [
        { id: 1, label: 'IR(CN1)', angle: 0, distance: 10, color: 'magenta' } // Same pos as CN2
    ]
};

function degreesToRadians(degrees) {
    return degrees * (Math.PI / 180);
}
export const COURSE_CONFIG = {
    strokeWidth: 20,
    color: 'black',
    backgroundColor: 'white',
    // Oval dimensions
    width: 600,
    height: 400,
};
