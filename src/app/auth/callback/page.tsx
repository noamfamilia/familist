"use client";

import { useEffect, useState } from "react";

export default function AuthCallbackDebug() {
  const [info, setInfo] = useState<any>(null);

  useEffect(() => {
    setInfo({
      href: window.location.href,
      search: window.location.search,
      hash: window.location.hash,
      code: new URLSearchParams(window.location.search).get("code"),
      type: new URLSearchParams(window.location.search).get("type"),
      hashParams: Object.fromEntries(new URLSearchParams(window.location.hash.slice(1))),
    });
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
      {info ? JSON.stringify(info, null, 2) : "Loading..."}
    </div>
  );
}
