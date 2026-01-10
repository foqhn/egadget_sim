/**
 * Transpiles C-like robot code into a secure JavaScript Generator Function.
 * This allows for 'wait_ms' and step-by-step execution.
 * @param {string} sourceCode 
 * @returns {Function|null} Generator constructor or null on error
 */
export const transpileCode = (sourceCode) => {
    try {
        // 0. Remove Comments (Line and Block) to prevent brace counting errors
        let cleanCode = sourceCode.replace(/\/\/.*$/gm, '').replace(/\/\*[\sS]*?\*\//g, '');

        // 1. Remove C-style casts like (ULNG), but preserve (TRUE) for loops
        // We use a negative lookahead (?!TRUE) to ensure we don't convert while(TRUE) to while
        cleanCode = cleanCode.replace(/\((?!TRUE\))[A-Z]+\)/g, "");

        // 2. Extract content inside user_main using brace counting
        const startRegex = /void\s+user_main\s*\(\s*void\s*\)\s*\{/;
        const startMatch = cleanCode.match(startRegex);
        if (!startMatch) throw new Error("Could not find user_main function");

        const startIndex = startMatch.index + startMatch[0].length;
        let braceCount = 1;
        let endIndex = -1;

        for (let i = startIndex; i < cleanCode.length; i++) {
            if (cleanCode[i] === '{') braceCount++;
            else if (cleanCode[i] === '}') braceCount--;

            if (braceCount === 0) {
                endIndex = i;
                break;
            }
        }

        if (endIndex === -1) throw new Error("Unbalanced braces in user_main");
        let body = cleanCode.substring(startIndex, endIndex);

        // 2.5 Convert C variable declarations to JavaScript
        // Handle 'const int' -> 'const'
        body = body.replace(/\bconst\s+(?:unsigned\s+)?(?:int|float|double|long|short|char|bool)\b/g, "const");
        // Handle 'int', 'float', etc. -> 'let'
        body = body.replace(/\b(?:unsigned\s+)?(?:int|float|double|long|short|char|bool)\b/g, "let");

        // 3. Transform 'while(TRUE)' -> 'while(true)' with yield
        // Wrap yield in parens to ensure object literal is parsed correctly
        body = body.replace(/while\s*\(\s*TRUE\s*\)\s*\{/g, "while(true) { yield ({type: 'tick'});");

        // 4. Transform 'wait_ms(X)' -> 'yield {type: 'wait', ms: X};'
        body = body.replace(/wait_ms\(([^)]+)\);/g, "yield ({type: 'wait', ms: $1});");

        // Debug: Log the generated body
        // console.log("Transpiled Body:", body);

        // 5. Wrap in a generator function
        const generatorCode = `
        return function* () {
          ${body}
        };
      `;

        // console.log("Generated Generator Code:", generatorCode); // Debug)

        try {
            const generatorFactory = new Function('gAD', 'motor', 'CN2', 'CN5', 'CN6', 'TRUE', generatorCode);
            return generatorFactory;
        } catch (syntaxError) {
            console.error("Syntax Error in Generated Code:", syntaxError);
            console.error("Code causing error:", generatorCode);
            throw syntaxError;
        }

    } catch (err) {
        console.error("Transpilation Error:", err);
        // console.error("Source:", sourceCode);
        return null;
    }
};
