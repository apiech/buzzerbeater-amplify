import { Alert } from "@/app/ui/primitives/alert";

export function WorkInProgressNotice({
  subject,
}: {
  subject: string;
}) {
  return (
    <Alert tone="note">
      <strong className="font-semibold text-ink">Work in progress (WIP):</strong>{" "}
      {subject} has not been thoroughly tested yet and is not fully ready.
    </Alert>
  );
}
