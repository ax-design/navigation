import typescript from 'rollup-plugin-typescript2';
import babelminify from 'rollup-plugin-babel-minify';
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';

const config = {
    input: './src/index.ts',
    output: {
        file: './build/main.js',
        format: 'umd',
        name: 'AxNavigation'
    },
    plugins: [babelminify(), typescript(), resolve(), commonjs()],
};

export default config;
