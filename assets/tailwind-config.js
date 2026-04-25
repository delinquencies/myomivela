window.tailwind = window.tailwind || {};

window.tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "secondary-dim": "#843a00",
        "tertiary-dim": "#005a54",
        "secondary-fixed-dim": "#ffb287",
        outline: "#906f68",
        "outline-variant": "#caa59c",
        "on-primary-fixed-variant": "#003c55",
        "secondary-container": "#ffc5a6",
        "surface-variant": "#ffd3c9",
        "on-error-container": "#570008",
        "inverse-primary": "#00baff",
        "on-tertiary-container": "#00534d",
        "on-secondary-fixed-variant": "#863b00",
        "surface-dim": "#fec8bc",
        "error-dim": "#9f0519",
        "on-secondary-fixed": "#592500",
        "tertiary-container": "#7fe6db",
        "on-secondary": "#fff0e9",
        "secondary-fixed": "#ffc5a6",
        "on-error": "#ffefee",
        "surface-container": "#ffe2db",
        "surface-tint": "#006289",
        "on-background": "#412923",
        "primary-fixed-dim": "#00abeb",
        "inverse-surface": "#1c0905",
        "on-primary-container": "#003248",
        "surface-container-lowest": "#ffffff",
        "tertiary-fixed": "#7fe6db",
        "on-tertiary-fixed": "#003e39",
        "on-surface-variant": "#72544e",
        "primary-container": "#00baff",
        "surface-bright": "#fff4f2",
        "on-primary-fixed": "#001723",
        background: "#fff4f2",
        "on-primary": "#e8f4ff",
        surface: "#fff4f2",
        "surface-container-highest": "#ffd3c9",
        "primary-fixed": "#00baff",
        "primary-dim": "#005578",
        "on-tertiary": "#bffff7",
        primary: "#006289",
        "surface-container-high": "#ffdad2",
        "inverse-on-surface": "#b9958d",
        "error-container": "#fb5151",
        "on-secondary-container": "#773400",
        tertiary: "#006760",
        "surface-container-low": "#ffede9",
        "tertiary-fixed-dim": "#71d7cd",
        secondary: "#974300",
        "on-tertiary-fixed-variant": "#005d57",
        error: "#b31b25",
        "on-surface": "#412923"
      },
      borderRadius: {
        DEFAULT: "1rem",
        lg: "2rem",
        xl: "3rem",
        full: "9999px"
      },
      spacing: {
        "container-max": "80rem",
        "header-height": "4.5rem",
        "bento-gap": "1.5rem",
        "inline-padding": "1rem",
        "nav-height": "6rem",
        "section-gap": "4rem"
      },
      fontFamily: {
        headline: ["Plus Jakarta Sans", "sans-serif"],
        body: ["Be Vietnam Pro", "sans-serif"],
        label: ["Be Vietnam Pro", "sans-serif"],
        "label-bold": ["Be Vietnam Pro", "sans-serif"],
        "body-md": ["Be Vietnam Pro", "sans-serif"],
        "body-xl": ["Be Vietnam Pro", "sans-serif"],
        "headline-lg": ["Plus Jakarta Sans", "sans-serif"],
        "display-xl": ["Plus Jakarta Sans", "sans-serif"]
      },
      fontSize: {
        "label-bold": ["0.875rem", { letterSpacing: "0.05em", fontWeight: "700" }],
        "body-md": ["1rem", { lineHeight: "1.5", fontWeight: "400" }],
        "body-xl": ["1.25rem", { lineHeight: "1.6", fontWeight: "500" }],
        "headline-lg": ["2.25rem", { lineHeight: "1.2", fontWeight: "700" }],
        "display-xl": ["4.5rem", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "800" }]
      }
    }
  }
};
