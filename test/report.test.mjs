import assert from "node:assert/strict";
import { test } from "node:test";

import { scrub } from "@/server/report";

test("hides cédulas and phones however riders write them", () => {
  assert.equal(scrub("mi cédula es 1.023.456.789"), "mi cédula es [número oculto]");
  assert.equal(scrub("cédula 52.345.678"), "cédula [número oculto]");
  assert.equal(scrub("cc 79123456"), "cc [número oculto]");
  assert.equal(scrub("llámame al 300 123 45 67"), "llámame al [teléfono oculto]");
  assert.equal(scrub("+57 300-123-4567"), "[teléfono oculto]");
  assert.equal(scrub("fijo 601 234 5678"), "fijo [teléfono oculto]");
  assert.equal(scrub("correo ana.perez@gmail.com"), "correo [correo oculto]");
  // Pasted from a contacts app or a chat, with non-breaking spaces; two spaces; a dash with spaces around it.
  assert.equal(scrub("mi número 300\u00a0123\u00a04567"), "mi número [teléfono oculto]");
  assert.equal(scrub("al 300  123  4567"), "al [teléfono oculto]");
  assert.equal(scrub("al 300 - 123 - 45 - 67"), "al [teléfono oculto]");
});

test("leaves addresses, route codes, bus numbers and times alone", () => {
  for (const text of ["Calle 72 # 10-34", "la ruta K635 no paró", "a las 12:30 en Portal Norte", "bus 7003 placa TGW244", "esperé 45 min", "Carrera 7 # 45-10"]) {
    assert.equal(scrub(text), text);
  }
});
