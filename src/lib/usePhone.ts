import { useEffect, useState } from "react";

// Phone-sized screens get the phone layout: the Android app, or any window this narrow
const phoneQuery = "(max-width: 640px)";

export function usePhone() {
  const [phone, setPhone] = useState(() => window.matchMedia(phoneQuery).matches);

  useEffect(() => {
    const query = window.matchMedia(phoneQuery);
    const update = () => setPhone(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return phone;
}
