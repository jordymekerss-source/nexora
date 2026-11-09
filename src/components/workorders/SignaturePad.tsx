"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { completeWorkOrderFormAction } from "@/app/actions/ops";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";

type Props = {
  projectId: string;
  projectTitle: string;
};

export function SignaturePad({ projectId, projectTitle }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [summary, setSummary] = useState(`Werkzaamheden afgerond op ${projectTitle}`);
  const [signature, setSignature] = useState("");
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#18181b";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, []);

  function pointerPos(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (canvas === null) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas === null || canvas === undefined || ctx === null || ctx === undefined) return;
    drawing.current = true;
    canvas.setPointerCapture(event.pointerId);
    const { x, y } = pointerPos(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx === null || ctx === undefined) return;
    const { x, y } = pointerPos(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  }

  function onPointerUp() {
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas !== null) {
      setSignature(canvas.toDataURL("image/png"));
    }
  }

  function clearPad() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas === null || canvas === undefined || ctx === null || ctx === undefined) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    setSignature("");
  }

  return (
    <form action={completeWorkOrderFormAction} className="space-y-4">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="signature_data_url" value={signature} />
      <Textarea
        name="work_summary"
        label="Werkbon samenvatting"
        required
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        rows={4}
      />

      <div>
        <div className="mb-2 text-sm font-medium text-zinc-200">Klant handtekening</div>
        <canvas
          ref={canvasRef}
          width={640}
          height={220}
          className="w-full touch-none rounded-md border border-zinc-600 bg-white"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <div className="mt-2 flex gap-2">
          <Button type="button" variant="ghost" onClick={clearPad}>
            Wissen
          </Button>
        </div>
      </div>

      <Button type="submit" disabled={!hasInk || signature.length === 0}>
        Werkbon afronden & opslaan
      </Button>
    </form>
  );
}
