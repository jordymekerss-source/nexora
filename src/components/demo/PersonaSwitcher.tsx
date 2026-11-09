import { switchDemoPersonaAction } from "@/app/actions/ops";
import { Button } from "@/components/ui/Button";

export function PersonaSwitcher({ current }: { current: string }) {
  return (
    <form action={switchDemoPersonaAction} className="flex flex-wrap gap-2">
      {(
        [
          ["employer", "Werkgever"],
          ["employee-0", "Sam Jansen"],
          ["employee-1", "Lisa de Vries"],
          ["employee-2", "Omar Hassan"],
        ] as const
      ).map(([value, label]) => (
        <Button
          key={value}
          type="submit"
          name="persona"
          value={value}
          variant={current === value ? "primary" : "secondary"}
        >
          {label}
        </Button>
      ))}
    </form>
  );
}
