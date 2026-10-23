import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative mb-4 w-full sm:max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text" inputMode="search"
        aria-label="Search clients by name"
        placeholder="Search client name…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 pl-9 pr-9 text-base sm:h-10 sm:text-sm"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
