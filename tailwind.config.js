/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: '#0b0c10',
        lightDark: '#1f2833',
        lightGray: '#c5c6c7',
        lightBlue: '#66FCF1',
        darkBlue: '#45A29E',
        // Add more colors as needed
      },
    },
  },
  plugins: [],
};
