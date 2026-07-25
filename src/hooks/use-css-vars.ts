import { useCallback, useEffect, useState } from "react";

export function useCssVars(...vars: string[]): string[] {
  const resolve = useCallback(() => {
    const style = getComputedStyle(document.documentElement);
    return vars.map((v) => style.getPropertyValue(v).trim() || v);
  }, []);
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
