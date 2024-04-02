// Rollup plugins
import babel from '@rollup/plugin-babel';
import eslint from '@rollup/plugin-eslint';
import replace from '@rollup/plugin-replace';
import {
    terser
} from 'rollup-plugin-terser';

export default {
    input: 'src/fmp4player.js',
    output: [{
            file: 'example/fmp4player.js',
            format: 'umd',
            name: 'FMP4Player',
            sourcemap: false, // 'inline'
            globals: {
            }
        },
        {
            file: 'dist/fmp4player.js',
            format: 'umd',
            name: 'FMP4Player',
            sourcemap: false,
            globals: {
            }
        }
    ],
    onwarn: function (message) {
        console.error(message);
    },
    plugins: [
        eslint(),
        babel({
            exclude: 'node_modules/**',
            babelHelpers: 'bundled'
        }),
        replace({
            exclude: 'node_modules/**',
            preventAssignment: true,
            ENV: JSON.stringify(process.env.NODE_ENV || 'development'),
        }),
        (process.env.NODE_ENV === 'production' && terser()),
    ],
    external: [],
};