/**
 * Transpiles C-like robot code into a secure JavaScript Generator Function.
 * This allows for 'wait_ms' and step-by-step execution.
 * @param {string} sourceCode 
 * @returns {Function|null} Generator constructor or null on error
 */
export const transpileCode = (sourceCode) => {
    try {
        // 0. Remove Comments
        let cleanCode = sourceCode.replace(/\/\/.*$/gm, '').replace(/\/\*[\sS]*?\*\//g, '');

        // 1. Remove C-style casts
        cleanCode = cleanCode.replace(/\((?!TRUE\))[A-Z]+\)/g, "");

        // Helper to extract all functions
        const extractFunctions = (code) => {
            const functions = [];
            let pos = 0;

            // Regex to find function header: type name(args) {
            // We ignore checking start of line, just look for patterns ending in {
            // Note: This matches "void user_main(void) {" or "int add(int a, int b) {"
            // We need to be careful about not matching "while(true) {" inside a function, 
            // but we are scanning top-level only if we skip over bodies correctly.

            while (pos < code.length) {
                const openBrace = code.indexOf('{', pos);
                if (openBrace === -1) break;

                // Check if this brace belongs to a function definition
                // Scan backwards from openBrace to finding a semicolon or closing brace or start of file
                // to isolate the header.
                let headerStart = pos;
                // Simple heuristic: Assume top-level { starts a function.
                // We will verify by checking if it looks like a function header.

                // Extract Header text
                const headerText = code.substring(pos, openBrace).trim();

                // Find closing brace
                let braceCount = 1;
                let closeBrace = -1;
                for (let i = openBrace + 1; i < code.length; i++) {
                    if (code[i] === '{') braceCount++;
                    else if (code[i] === '}') braceCount--;

                    if (braceCount === 0) {
                        closeBrace = i;
                        break;
                    }
                }

                if (closeBrace === -1) throw new Error("Unbalanced braces");

                // Parse Header
                // Expected format: "rettype name ( args )"
                // Remove newlines
                const cleanHeader = headerText.replace(/\s+/g, ' ');
                // Match regex: ([\w]+)\s+([\w]+)\s*\(([^)]*)\)$
                // Capture group 2 is name, group 3 is args
                const headerMatch = cleanHeader.match(/[\w]+\s+([\w]+)\s*\(([^)]*)\)$/);

                if (headerMatch) {
                    const funcName = headerMatch[1];
                    const funcArgs = headerMatch[2];
                    const funcBody = code.substring(openBrace + 1, closeBrace);
                    functions.push({ name: funcName, args: funcArgs, body: funcBody });
                }

                pos = closeBrace + 1;
            }
            return functions;
        };

        const functions = extractFunctions(cleanCode);
        const userMain = functions.find(f => f.name === 'user_main');

        if (!userMain) throw new Error("user_main function not found");

        const userFunctionNames = functions.map(f => f.name).filter(n => n !== 'user_main');

        const processBody = (body, definedFuncs) => {
            // 2.5 Convert C variable declarations to JavaScript
            let b = body.replace(/\bconst\s+(?:unsigned\s+)?(?:int|float|double|long|short|char|bool)\b/g, "const");
            b = b.replace(/\b(?:unsigned\s+)?(?:int|float|double|long|short|char|bool)\b/g, "let");

            // 3. Transform 'while(TRUE)' -> 'while(true)' with yield
            b = b.replace(/while\s*\(\s*TRUE\s*\)\s*\{/g, "while(true) { yield ({type: 'tick'});");

            // 4. Transform 'wait_ms(X)' -> 'yield {type: 'wait', ms: X};'
            b = b.replace(/wait_ms\(([^)]+)\);/g, "yield ({type: 'wait', ms: $1});");

            // 5. Transform calling user functions to 'yield* func()' to support nested waits
            if (definedFuncs && definedFuncs.length > 0) {
                // Regex matches: WordBoundary + (func1|func2...) + Whitespace + (
                const pattern = new RegExp(`\\b(${definedFuncs.join('|')})\\s*\\(`, 'g');
                b = b.replace(pattern, "yield* $1(");
            }

            return b;
        };

        const processArgs = (argsStr) => {
            if (!argsStr || argsStr.trim() === 'void') return '';
            // Split by comma
            return argsStr.split(',').map(arg => {
                // "int a" -> "a"
                const parts = arg.trim().split(/\s+/);
                return parts[parts.length - 1].replace('*', ''); // Handle pointers crudely
            }).join(', ');
        };

        // Construct Generator Factory Code
        const gV_Constants = `
        const VAR_A = 0;
        const VAR_B = 1;
        const VAR_C = 2;
        const VAR_D = 3;
        const VAR_E = 4;
        const VAR_F = 5;
        const VAR_G = 6;
        const VAR_H = 7;
        const VAR_I = 8;
        const VAR_J = 9;
        `;

        let subroutinesCode = '';
        functions.forEach(f => {
            if (f.name === 'user_main') return;
            // Transpile subroutine as Generator to support yield
            const jsArgs = processArgs(f.args);
            // Recursively transform calls inside subroutines too
            const jsBody = processBody(f.body, userFunctionNames);
            subroutinesCode += `
            function* ${f.name}(${jsArgs}) {
                ${jsBody}
            }
            `;
        });

        // Transform main body, also handling function calls
        const mainBody = processBody(userMain.body, userFunctionNames);

        const generatorCode = `
        ${gV_Constants}
        ${subroutinesCode}
        return function* () {
          ${mainBody}
        };
      `;

        // console.log("Generated Generator Code:", generatorCode); 

        try {
            // Add 'gV' to the arguments
            const generatorFactory = new Function('gAD', 'gV', 'motor', 'CN2', 'CN5', 'CN6', 'TRUE', generatorCode);
            return generatorFactory;
        } catch (syntaxError) {
            console.error("Syntax Error in Generated Code:", syntaxError);
            console.error("Code causing error:", generatorCode);
            throw syntaxError;
        }

    } catch (err) {
        console.error("Transpilation Error:", err);
        return null;
    }
};
