export const authTheme = {
  name: "bb-auth-theme",
  tokens: {
    colors: {
      brand: {
        primary: {
          10: { value: "rgba(180, 77, 36, 0.12)" },
          60: { value: "#b44d24" },
          80: { value: "#8d3816" },
          90: { value: "#732d12" },
        },
      },
      background: {
        primary: { value: "transparent" },
        secondary: { value: "rgba(255, 252, 247, 0.75)" },
      },
      font: {
        primary: { value: "#1f2a33" },
        secondary: { value: "#4b5d6a" },
        interactive: { value: "#8d3816" },
      },
      border: {
        primary: { value: "rgba(33, 51, 63, 0.16)" },
        focus: { value: "#b44d24" },
      },
    },
    radii: {
      large: { value: "1rem" },
      xl: { value: "1.5rem" },
    },
    shadows: {
      small: {
        value: {
          blurRadius: "0px",
          color: "transparent",
          offsetX: "0px",
          offsetY: "0px",
        },
      },
      medium: {
        value: {
          blurRadius: "0px",
          color: "transparent",
          offsetX: "0px",
          offsetY: "0px",
        },
      },
      large: {
        value: {
          blurRadius: "0px",
          color: "transparent",
          offsetX: "0px",
          offsetY: "0px",
        },
      },
    },
  },
} as const;
