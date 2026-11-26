import { ArrowLeftRight } from "lucide-react";

export default function ReverseRefillButton({ name, reversed, onReverse }: {
  name: string;
  reversed: boolean;
  onReverse: () => void;
}) {
  return <button type="button" className="reverse-refill" aria-label={"Reverse " + name}
    aria-pressed={reversed} title="Swap the tip and tail in place" onClick={onReverse}>
    <ArrowLeftRight size={14} aria-hidden="true"/> Reverse
  </button>;
}
