// Whether the page is laid out for a phone.
import { useEffect, useLayoutEffect, useState } from "react";
import { alarmsAvailable as onAndroid } from "./alarms";

// The Android app always gets the phone layout, upright or on its side. Elsewhere (the desktop's
// phone view, a browser) a window this narrow gets it.
const phoneQuery = "(max-width: 640px)";

// Also marks the page with `data-phone`, which the `phone:` style variant reads
export function usePhone() {
  const [phone, setPhone] = useState(() => onAndroid || window.matchMedia(phoneQuery).matches);

  useEffect(() => {
    if (onAndroid) return;
    const query = window.matchMedia(phoneQuery);
    const update = () => setPhone(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.toggleAttribute("data-phone", phone);
  }, [phone]);

  return phone;
}
