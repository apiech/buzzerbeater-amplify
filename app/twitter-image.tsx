import { ImageResponse } from "next/og";

import { siteTagline } from "@/app/site-config";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        background:
          "radial-gradient(circle at top left, rgba(216, 131, 77, 0.24), transparent 25%), radial-gradient(circle at bottom right, rgba(44, 94, 129, 0.22), transparent 32%), linear-gradient(135deg, #f5efe4 0%, #fbf7f0 48%, #eef3f6 100%)",
        color: "#1f2a33",
        padding: "56px",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          width: "100%",
          borderRadius: "40px",
          border: "1px solid rgba(31, 42, 51, 0.12)",
          background: "rgba(255, 252, 247, 0.88)",
          padding: "44px",
          gap: "34px",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: "168px",
            height: "168px",
            borderRadius: "40px",
            background: "#1f2a33",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "136px",
              height: "136px",
              borderRadius: "32px",
              background: "#f6efe4",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "72px",
                height: "72px",
                borderRadius: "999px",
                background: "#d8834d",
                border: "4px solid #163347",
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
            BuzzerBeater Assistant Coach
          </div>
          <div
            style={{
              fontSize: "62px",
              lineHeight: 1,
              fontWeight: 800,
              letterSpacing: "-0.06em",
            }}
          >
            Your club workspace.
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
