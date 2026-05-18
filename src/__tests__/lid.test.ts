import { describe, expect, it, vi } from "vitest";
import { makeLidResolver } from "../lid.js";
import type { WhatsAppSocket } from "../types.js";

describe("makeLidResolver", () => {
  it("delegates getLIDForPN to the socket's lid mapping store", async () => {
    const getLIDForPN = vi.fn().mockResolvedValue("11122233344455@lid");
    const socket = {
      signalRepository: { lidMapping: { getLIDForPN, getPNForLID: vi.fn() } },
    } as unknown as WhatsAppSocket;

    const resolver = makeLidResolver(socket);
    const lid = await resolver.getLIDForPN("555177776666@s.whatsapp.net");

    expect(lid).toBe("11122233344455@lid");
    expect(getLIDForPN).toHaveBeenCalledWith("555177776666@s.whatsapp.net");
  });

  it("delegates getPNForLID to the socket's lid mapping store", async () => {
    const getPNForLID = vi.fn().mockResolvedValue("555177776666@s.whatsapp.net");
    const socket = {
      signalRepository: { lidMapping: { getLIDForPN: vi.fn(), getPNForLID } },
    } as unknown as WhatsAppSocket;

    const resolver = makeLidResolver(socket);
    const pn = await resolver.getPNForLID("11122233344455@lid");

    expect(pn).toBe("555177776666@s.whatsapp.net");
    expect(getPNForLID).toHaveBeenCalledWith("11122233344455@lid");
  });

  it("returns null when the store cannot resolve a mapping", async () => {
    const socket = {
      signalRepository: {
        lidMapping: {
          getLIDForPN: vi.fn().mockResolvedValue(null),
          getPNForLID: vi.fn().mockResolvedValue(null),
        },
      },
    } as unknown as WhatsAppSocket;

    const resolver = makeLidResolver(socket);
    expect(await resolver.getPNForLID("unknown@lid")).toBeNull();
  });
});
