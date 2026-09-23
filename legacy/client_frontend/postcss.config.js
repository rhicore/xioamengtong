export default {
  plugins: {
    "@tailwindcss/postcss": {}, // 👈 注意：v4 必须用这个包名，而不是原来的 'tailwindcss'
    autoprefixer: {},
  },
}