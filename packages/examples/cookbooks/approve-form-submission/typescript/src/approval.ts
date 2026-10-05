export class SubmissionGuard {
  private state: "empty" | "filling" | "filled" | "approved" | "rejected" | "attempted" = "empty";

  beforeFill(): void {
    if (this.state !== "empty") throw new Error("Form values are frozen after filling");
    this.state = "filling";
  }
  markFilled(): void {
    if (this.state !== "filling") throw new Error("No fill is in progress");
    this.state = "filled";
  }
  decide(approved: boolean): void {
    if (this.state !== "filled")
      throw new Error("Approval requires a filled form and one decision");
    this.state = approved ? "approved" : "rejected";
  }
  claimSubmit(): void {
    if (this.state !== "approved")
      throw new Error("Submission is unapproved or was already attempted");
    // Mark before the browser call. A timeout may mean the server accepted the form.
    this.state = "attempted";
  }
}
