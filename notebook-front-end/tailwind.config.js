/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // 👈 这一行最关键，它告诉 Tailwind 去哪里扫描样式
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}