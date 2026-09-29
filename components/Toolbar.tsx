"use client";

export type Tool = "none" | "bearing" | "route";

// Holo buttons along the bottom of the table: the hotkey tools made findable (and usable by touch).
// data-ui keeps the map's drag/click handlers off it.
export default function Toolbar(props: {
  tool: Tool;
  hint: string;
  copied: boolean;
  onTool: (t: Tool) => void;
  onClear: () => void;
  onShare: () => void;
  onAbout: () => void;
}) {
  const btn = (on: boolean) =>
    `cursor-pointer border px-2.5 leading-7 outline-none transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#9ff0ff] max-[700px]:px-1 max-[700px]:leading-6 ${
      on
        ? "border-[#9ff0ff] bg-[#9ff0ff]/20 text-[#e6fdff] shadow-[0_0_12px_rgba(90,220,255,0.55),inset_0_0_8px_rgba(90,220,255,0.35)]"
        : "border-[#9ff0ff]/40 bg-[#041019]/70 hover:bg-[#9ff0ff]/10"
    }`;
  return (
    <div data-ui className="absolute bottom-12 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5 max-[700px]:bottom-3">
      {props.hint && (
        <div role="status" className="max-w-[min(520px,90vw)] border border-[#ffd27a]/40 bg-[#1a1204]/85 px-2 text-center text-lg leading-6 text-[#ffd27a] [text-shadow:0_0_6px_rgba(255,200,110,0.6)] max-[700px]:text-base max-[700px]:leading-5">
          {props.hint}
        </div>
      )}
      <div role="toolbar" aria-label="Map tools" className="flex gap-1.5 text-xl text-[#9ff0ff] [text-shadow:0_0_6px_rgba(90,220,255,0.7)] max-[700px]:gap-1 max-[700px]:text-base">
        <button type="button" aria-pressed={props.tool === "bearing"} onClick={() => props.onTool(props.tool === "bearing" ? "none" : "bearing")} className={btn(props.tool === "bearing")}>
          BEARING
        </button>
        <button type="button" aria-pressed={props.tool === "route"} onClick={() => props.onTool(props.tool === "route" ? "none" : "route")} className={btn(props.tool === "route")}>
          ROUTE
        </button>
        <button type="button" onClick={props.onClear} className={btn(false)}>CLEAR</button>
        <button type="button" onClick={props.onShare} className={btn(false)}>{props.copied ? "LINK COPIED" : "SHARE"}</button>
        <button type="button" aria-label="How it works" onClick={props.onAbout} className={btn(false)}>?</button>
      </div>
    </div>
  );
}
