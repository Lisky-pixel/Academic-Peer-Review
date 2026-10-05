/**
 * The soft backdrop behind every page: three pools of blue
 * under a faint dot grid. Its parent needs `relative isolate` so that it sits
 * behind that page's content and nothing else.
 */
export function Backdrop() {
  return (
    <div aria-hidden className="app-backdrop">
      <span
        className="backdrop-pool top-[-8rem] left-[-6rem] size-[34rem]"
        style={{ background: "var(--backdrop-a)" }}
      />
      <span
        className="backdrop-pool top-[4rem] right-[-10rem] size-[32rem]"
        style={{ background: "var(--backdrop-b)" }}
      />
      <span
        className="backdrop-pool bottom-[-14rem] left-[30%] size-[38rem]"
        style={{ background: "var(--backdrop-c)" }}
      />
    </div>
  );
}
