import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Letter } from "@/fetchers/correspondence/letters";

vi.mock("@/hooks/queries/correspondence/use-config", () => ({
  useConfigList: () => ({ data: [] }),
}));
vi.mock("@/hooks/queries/correspondence/use-mediums", () => ({
  useLetterMediums: () => ({
    options: [
      { value: "email", label: "Email" },
      { value: "whatsapp", label: "WhatsApp" },
    ],
    labelOf: (key: string) =>
      ({ email: "Email", whatsapp: "WhatsApp", fax: "Fax" })[key] ?? key,
  }),
}));

import { LetterEditForm } from "./letter-edit-form";

function letter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: "l1",
    workspaceId: "ws-1",
    refNo: null,
    direction: "in",
    type: "external",
    medium: "email",
    subject: "Permohonan kerjasama",
    senderName: "Encik Ali",
    senderOrg: null,
    senderEmail: null,
    recipientName: null,
    recipientOrg: null,
    recipientEmail: null,
    letterDate: null,
    receivedAt: null,
    externalRefNo: null,
    fileRef: null,
    urgency: "normal",
    organisationId: null,
    declaredAt: null,
    status: "captured",
    ...overrides,
  } as Letter;
}

function setup(target: Letter) {
  const onSave = vi.fn();
  render(
    <LetterEditForm
      letter={target}
      workspaceId="ws-1"
      pending={false}
      onCancel={vi.fn()}
      onSave={onSave}
    />,
  );
  return { onSave };
}

describe("LetterEditForm", () => {
  it("edits an unregistered letter without asking for a reason", async () => {
    const { onSave } = setup(letter());
    expect(screen.queryByLabelText(/Reason for the correction/)).toBeNull();
    const name = screen.getByLabelText("Sender name");
    await userEvent.clear(name);
    await userEvent.type(name, "Encik Abu");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ senderName: "Encik Abu" }),
    );
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("correctionReason");
  });

  it("asks for a reason before correcting a registered letter, and sends it", async () => {
    const { onSave } = setup(
      letter({
        refNo: "MAPIM/2026/0001",
        declaredAt: "2026-10-01T00:00:00.000Z",
        status: "registered",
      }),
    );
    expect(
      screen.getByText(/registered as MAPIM\/2026\/0001/),
    ).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save correction" });
    expect(save).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText(/Reason for the correction/),
      "Sender's name was mistyped",
    );
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        correctionReason: "Sender's name was mistyped",
      }),
    );
  });

  it("keeps a retired medium selectable on a letter that already has it", () => {
    setup(letter({ medium: "fax" }));
    expect(screen.getByRole("combobox", { name: "Medium" })).toHaveTextContent(
      "Fax",
    );
  });
});
