import { ImageResponse } from "next/og";

import { siteName, siteTagline } from "@/app/site-config";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        background:
          "radial-gradient(circle at top left, rgba(216, 131, 77, 0.28), transparent 26%), radial-gradient(circle at bottom right, rgba(44, 94, 129, 0.24), transparent 34%), linear-gradient(135deg, #f3ecdf 0%, #fbf7f0 48%, #eef3f6 100%)",
        color: "#1f2a33",
        padding: "56px",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          width: "100%",
          border: "1px solid rgba(31, 42, 51, 0.12)",
          borderRadius: "40px",
          background: "rgba(255, 252, 247, 0.86)",
          boxShadow:
            "0 18px 40px rgba(31, 42, 51, 0.12), 0 2px 10px rgba(31, 42, 51, 0.05)",
          padding: "40px 44px",
          gap: "34px",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: "176px",
            height: "176px",
            borderRadius: "42px",
            background: "#1f2a33",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "144px",
              height: "144px",
              borderRadius: "34px",
              background: "#f6efe4",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            <div
              style={{
                width: "74px",
                height: "74px",
                borderRadius: "999px",
                background: "#d8834d",
                border: "4px solid #163347",
              }}
            />
            <div
              style={{
                position: "absolute",
                width: "10px",
                height: "96px",
                borderRadius: "999px",
                background: "#2c5e81",
              }}
            />
            <div
              style={{
                position: "absolute",
                width: "96px",
                height: "10px",
                borderRadius: "999px",
                background: "#2c5e81",
              }}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            gap: "18px",
          }}
        >
          <div
            style={{
              fontSize: "22px",
              fontWeight: 800,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#b44d24",
            }}
          >
            Private BuzzerBeater companion
          </div>
          <div
            style={{
              fontSize: "66px",
              lineHeight: 1,
              fontWeight: 800,
              letterSpacing: "-0.06em",
            }}
          >
            {siteName}
          </div>
          <div
            style={{
              fontSize: "30px",
              lineHeight: 1.35,
              color: "#4b5d6a",
              maxWidth: "760px",
            }}
          >
            {siteTagline}
          </div>
        </div>
      </div>
    </div>,
    size,
  );
}
