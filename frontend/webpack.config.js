const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
const dotenv = require('dotenv');

const fileEnv = dotenv.config().parsed || {};
// Merge file-based env with OS-level env vars (so Render/CI dashboard vars work)
const env = {
  REACT_APP_BACKEND_URL: process.env.REACT_APP_BACKEND_URL || fileEnv.REACT_APP_BACKEND_URL,
  REACT_APP_GOOGLE_FIT_CLIENT_ID: process.env.REACT_APP_GOOGLE_FIT_CLIENT_ID || fileEnv.REACT_APP_GOOGLE_FIT_CLIENT_ID,
};

module.exports = {
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'babel-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
    }),
    new webpack.DefinePlugin({
      'process.env.REACT_APP_BACKEND_URL': JSON.stringify(env.REACT_APP_BACKEND_URL || 'http://localhost:5001'),
      'process.env.REACT_APP_GOOGLE_FIT_CLIENT_ID': JSON.stringify(env.REACT_APP_GOOGLE_FIT_CLIENT_ID || ''),
    }),
  ],
  devServer: {
    host: '0.0.0.0',
    port: 4000,
    hot: true,
    open: true,
    allowedHosts: 'all',
  },
};
