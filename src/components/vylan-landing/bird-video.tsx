"use client";

// The looping flapping-bird clip that sits fixed behind everything on
// the marketing pages (landing + manifesto), masked into a soft ellipse
// by `.vy-figure video` in vylan-landing.css. The video is self-hosted
// at /vylan-bird.mp4 (the user's exported clip). playbackRate 0.82 is
// the design's default wingbeat (cycle 1.7 → 1.4/1.7).
export function BirdVideo() {
  return (
    <div className="vy-figure" aria-hidden="true">
      <video
        src="/vylan-bird.mp4"
        autoPlay
        loop
        muted
        playsInline
        onLoadedData={(e) => {
          e.currentTarget.playbackRate = 0.82;
          e.currentTarget.play().catch(() => {});
        }}
      />
    </div>
  );
}
