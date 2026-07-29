import { useCallback, useEffect, useState } from "react";

export function useCssVars(...vars: string[]): string[] {
  // `vars` is a rest param, so it is a fresh array every render — using it as a
  // dependency would loop forever, and an empty dep array froze `resolve` on the
  // first render's list. Key on the joined names instead: a stable primitive
  // that still changes when the caller actually asks for different variables.
  const key = vars.join(",");
  const resolve = useCallback(() => {
    const style = getComputedStyle(document.documentElement);
    return key.split(",").map((v) => style.getPropertyValue(v).trim() || v);
  }, [key]);
  const [values, setValues] = useState<string[]>(() =>
    typeof window !== "undefined" ? resolve() : vars,
  );
  useEffect(() => {
    setValues(resolve());
    const observer = new MutationObserver(() => setValues(resolve()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [resolve]);
  return values;
}
