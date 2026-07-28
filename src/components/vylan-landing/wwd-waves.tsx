// Ambient "wave" art for the What we do / how it works page.
//
// Ported from the Claude Design "Vylan What We Do" handoff (project ef1c4ddf),
// which threads one continuous light-trail motif through every section: a soft
// blurred stroke with a hairline riding on top of it. The first port of the
// page dropped them; this file is the whole set, one component per section, so
// the page body stays readable and each wave lives next to its own geometry.
//
// All of them are PURELY DECORATIVE: aria-hidden, pointer-events:none, and
// absolutely positioned by a `wwd-wave-*` class in vylan-landing.css. None of
// them animate — motion here would compete with the reveals and the spine, and
// there is nothing for a reduced-motion user to opt out of.
//
// Gradient/filter ids are prefixed `wwd-` because these render inside the same
// document as the page's other inline SVG (the step and trust icons); an id
// collision would silently repaint the wrong stroke.
//
// The trust band is the one that sits on the light (#F4F2EC) panel, so its
// strokes are the brand blue rather than white — the design's #2347F2 is our
// --vy-blue, matching how the rest of this page was rebranded.

const BRAND = "#1050ed"; // --vy-blue, inlined: SVG stops can't read the token
                         // through the CSS cascade in every browser we support.

export function WaveHero() {
  return (
    <svg
      className="wwd-wave wwd-wave-hero"
      viewBox="0 0 1440 420"
      fill="none"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wwd-kwg1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".72" stopColor="#fff" stopOpacity=".4" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wwd-kwg2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#74D0FF" stopOpacity="0" />
          <stop offset=".28" stopColor="#9BE8FF" stopOpacity=".4" />
          <stop offset="1" stopColor="#74D0FF" stopOpacity="0" />
        </linearGradient>
        <filter id="wwd-kwb" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <path
        d="M-40 280 C 320 160, 640 380, 980 260 S 1380 100, 1480 160"
        stroke="url(#wwd-kwg2)"
        strokeWidth="7"
        filter="url(#wwd-kwb)"
      />
      <path
        d="M-40 280 C 320 160, 640 380, 980 260 S 1380 100, 1480 160"
        stroke="url(#wwd-kwg1)"
        strokeWidth="1.8"
      />
      <path
        d="M-40 340 C 360 240, 700 400, 1060 280 S 1420 160, 1480 200"
        stroke="url(#wwd-kwg1)"
        strokeWidth="1"
        opacity=".6"
      />
    </svg>
  );
}

export function WaveProblem() {
  return (
    <svg
      className="wwd-wave wwd-wave-problem"
      viewBox="0 0 820 400"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wwd-prg1" x1="0" y1="0" x2="1" y2=".4">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id="wwd-prb" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <path
        d="M-30 80 C 180 200, 380 60, 560 220 S 800 340, 850 300"
        stroke="url(#wwd-prg1)"
        strokeWidth="6"
        filter="url(#wwd-prb)"
      />
      <path
        d="M-30 80 C 180 200, 380 60, 560 220 S 800 340, 850 300"
        stroke="url(#wwd-prg1)"
        strokeWidth="1.5"
      />
      <path
        d="M-30 160 C 200 260, 400 140, 580 280"
        stroke="url(#wwd-prg1)"
        strokeWidth="1"
        opacity=".6"
      />
    </svg>
  );
}

// Violet, to match the "Workflow automation" eyebrow's accent.
export function WaveWorkflow() {
  return (
    <svg
      className="wwd-wave wwd-wave-wf"
      viewBox="0 0 900 460"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wwd-wag1" x1="1" y1="0" x2="0" y2=".5">
          <stop offset="0" stopColor="#B69CFF" stopOpacity=".45" />
          <stop offset="1" stopColor="#B69CFF" stopOpacity="0" />
        </linearGradient>
        <filter id="wwd-wab" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <path
        d="M930 120 C 720 40, 520 260, 300 180 S 40 120, -30 220"
        stroke="url(#wwd-wag1)"
        strokeWidth="7"
        filter="url(#wwd-wab)"
      />
      <path
        d="M930 120 C 720 40, 520 260, 300 180 S 40 120, -30 220"
        stroke="url(#wwd-wag1)"
        strokeWidth="1.6"
      />
      <path
        d="M930 220 C 700 160, 500 340, 280 260"
        stroke="url(#wwd-wag1)"
        strokeWidth="1"
        opacity=".55"
      />
    </svg>
  );
}

// The densest of the set — four strokes, because it carries the top-right of
// the otherwise flat dark auto-filing band on its own.
export function WaveFiling() {
  return (
    <svg
      className="wwd-wave wwd-wave-filing"
      viewBox="0 0 900 420"
      fill="none"
      preserveAspectRatio="xMaxYMin meet"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wwd-wv1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#74D0FF" stopOpacity="0" />
          <stop offset=".45" stopColor="#74D0FF" stopOpacity=".55" />
          <stop offset=".75" stopColor="#9BE8FF" stopOpacity=".8" />
          <stop offset="1" stopColor="#74D0FF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wwd-wv2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#74D0FF" stopOpacity="0" />
          <stop offset=".5" stopColor="#74D0FF" stopOpacity=".3" />
          <stop offset="1" stopColor="#74D0FF" stopOpacity="0" />
        </linearGradient>
        <filter id="wwd-wvb" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <path
        d="M-20 300 C 200 180, 420 330, 620 210 S 880 60, 940 90"
        stroke="url(#wwd-wv1)"
        strokeWidth="2.2"
      />
      <path
        d="M-20 330 C 220 230, 430 300, 640 190 S 890 40, 950 80"
        stroke="url(#wwd-wv2)"
        strokeWidth="8"
        filter="url(#wwd-wvb)"
      />
      <path
        d="M-20 260 C 240 160, 460 350, 680 240 S 900 110, 950 130"
        stroke="url(#wwd-wv2)"
        strokeWidth="1.4"
      />
      <path
        d="M0 350 C 260 270, 480 260, 660 170 S 880 30, 940 60"
        stroke="url(#wwd-wv1)"
        strokeWidth="1"
        opacity=".7"
      />
    </svg>
  );
}

// Cyan → mint: the payment section's own gradient, running the width of the
// viewport so the trail reads as continuing past the content column.
export function WavePay() {
  return (
    <svg
      className="wwd-wave wwd-wave-pay"
      viewBox="0 0 1440 480"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wwd-ppg1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#74D0FF" stopOpacity="0" />
          <stop offset=".45" stopColor="#74D0FF" stopOpacity=".35" />
          <stop offset=".75" stopColor="#63E2A8" stopOpacity=".35" />
          <stop offset="1" stopColor="#63E2A8" stopOpacity="0" />
        </linearGradient>
        <filter id="wwd-ppb" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <path
        d="M-40 340 C 340 420, 640 160, 1000 240 S 1380 380, 1480 320"
        stroke="url(#wwd-ppg1)"
        strokeWidth="7"
        filter="url(#wwd-ppb)"
      />
      <path
        d="M-40 340 C 340 420, 640 160, 1000 240 S 1380 380, 1480 320"
        stroke="url(#wwd-ppg1)"
        strokeWidth="1.6"
      />
      <path
        d="M-40 420 C 380 480, 680 260, 1040 320"
        stroke="url(#wwd-ppg1)"
        strokeWidth="1"
        opacity=".5"
      />
    </svg>
  );
}

// The only wave on a LIGHT panel, so it inverts: brand blue on cream.
export function WaveTrust() {
  return (
    <svg
      className="wwd-wave wwd-wave-trust"
      viewBox="0 0 900 480"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wwd-trg1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={BRAND} stopOpacity=".5" />
          <stop offset=".5" stopColor="#3D7BFF" stopOpacity=".65" />
          <stop offset="1" stopColor={BRAND} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wwd-trg2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={BRAND} stopOpacity=".4" />
          <stop offset=".7" stopColor={BRAND} stopOpacity=".18" />
          <stop offset="1" stopColor={BRAND} stopOpacity="0" />
        </linearGradient>
        <filter id="wwd-trb" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <path
        d="M-40 300 C 180 180, 380 380, 580 240 S 840 90, 940 150"
        stroke="url(#wwd-trg1)"
        strokeWidth="14"
        filter="url(#wwd-trb)"
      />
      <path
        d="M-40 300 C 180 180, 380 380, 580 240 S 840 90, 940 150"
        stroke="url(#wwd-trg1)"
        strokeWidth="2.6"
      />
      <path
        d="M-40 210 C 200 330, 400 170, 620 290 S 860 230, 940 260"
        stroke="url(#wwd-trg2)"
        strokeWidth="2"
      />
      <path
        d="M-40 370 C 220 260, 420 420, 640 310 S 880 160, 940 210"
        stroke="url(#wwd-trg2)"
        strokeWidth="1.4"
      />
      <path
        d="M-40 260 C 190 230, 360 300, 560 260"
        stroke="url(#wwd-trg2)"
        strokeWidth="5"
        filter="url(#wwd-trb)"
        opacity=".7"
      />
    </svg>
  );
}

export function WaveClose() {
  return (
    <svg
      className="wwd-wave wwd-wave-close"
      viewBox="0 0 1440 560"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wwd-ctg1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wwd-ctg2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#74D0FF" stopOpacity="0" />
          <stop offset=".5" stopColor="#9BE8FF" stopOpacity=".4" />
          <stop offset="1" stopColor="#74D0FF" stopOpacity="0" />
        </linearGradient>
        <filter id="wwd-ctb" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <path
        d="M-40 380 C 360 240, 680 440, 1020 280 S 1400 140, 1480 200"
        stroke="url(#wwd-ctg2)"
        strokeWidth="8"
        filter="url(#wwd-ctb)"
      />
      <path
        d="M-40 380 C 360 240, 680 440, 1020 280 S 1400 140, 1480 200"
        stroke="url(#wwd-ctg1)"
        strokeWidth="1.6"
      />
      <path
        d="M-40 300 C 400 180, 720 380, 1060 220 S 1420 100, 1480 150"
        stroke="url(#wwd-ctg1)"
        strokeWidth="1"
        opacity=".6"
      />
    </svg>
  );
}
