"use client";

import { Camera, Trash2 } from "lucide-react";
import { useActionState, useRef, useState, useTransition } from "react";
import {
  changePasswordAction,
  removeAvatarAction,
  updateProfileAction,
  uploadAvatarAction,
} from "@/app/(account)/profile/actions";
import { Field, FormError, FormMessage } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/user-avatar";
import type { FormState } from "@/lib/auth/schemas";
import { AVATAR_SIZE } from "@/lib/profile/avatar";

const INITIAL: FormState = {};
const BIO_MAX = 280;

/**
 * Crops a picture to a centred square and scales it to AVATAR_SIZE.
 *
 * Done in the browser so the upload is a few kilobytes whatever the camera
 * produced, and — because the pixels are redrawn onto a canvas — so the file
 * that leaves the device carries no EXIF data such as where it was taken.
 */
async function resizeToSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");

  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the picture"))),
      "image/jpeg",
      0.88,
    );
  });
}

export function AvatarUploader({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again still fires a change event.
    event.target.value = "";
    if (!file) return;

    setError(undefined);
    startTransition(async () => {
      let picture: Blob;
      try {
        picture = await resizeToSquare(file);
      } catch {
        setError("That file is not a picture we can use. Try a JPEG or PNG.");
        return;
      }

      const formData = new FormData();
      formData.set("avatar", picture, "avatar.jpg");
      const result = await uploadAvatarAction(formData);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-5">
        <UserAvatar name={name} url={avatarUrl} className="size-20 text-2xl" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            id="avatar-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={onFileChosen}
            aria-label="Choose a profile picture"
          />
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            <Camera aria-hidden />
            {pending ? "Uploading…" : avatarUrl ? "Change picture" : "Upload a picture"}
          </Button>
          {avatarUrl && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={pending}
              onClick={() => startTransition(() => removeAvatarAction())}
            >
              <Trash2 aria-hidden />
              Remove
            </Button>
          )}
        </div>
      </div>
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </div>
  );
}

export function ProfileForm({ name, bio, email }: { name: string; bio: string; email: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, INITIAL);
  const [bioLength, setBioLength] = useState(bio.length);
  const bioErrors = state.fieldErrors?.bio;

  return (
    <form action={action} className="space-y-5">
      <FormError state={state} />
      {state.success && <FormMessage tone="success">Your profile has been saved.</FormMessage>}

      <Field
        name="name"
        label="Full name"
        autoComplete="name"
        state={state}
        defaultValue={state.values?.name ?? name}
      />

      <Field
        name="email-display"
        label="Email"
        type="email"
        state={INITIAL}
        defaultValue={email}
        hint="Your email is how you sign in and cannot be changed here."
        disabled
        required={false}
      />

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <Label htmlFor="bio">Short bio</Label>
          <span className="text-muted-foreground text-xs tabular-nums">
            {bioLength}/{BIO_MAX}
          </span>
        </div>
        <textarea
          id="bio"
          name="bio"
          rows={4}
          maxLength={BIO_MAX}
          defaultValue={state.values?.bio ?? bio}
          onChange={(event) => setBioLength(event.target.value.length)}
          aria-invalid={bioErrors ? true : undefined}
          aria-describedby="bio-hint"
          className="border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive w-full resize-y rounded-lg border px-3 py-2 text-sm leading-relaxed shadow-xs outline-none focus-visible:ring-3"
        />
        <p
          id="bio-hint"
          className={bioErrors ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
        >
          {bioErrors ? bioErrors.join(" ") : "Optional. Only administrators can read this."}
        </p>
      </div>

      <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, INITIAL);

  return (
    // Keyed on success so the fields empty themselves once the change is made.
    <form action={action} className="space-y-5" key={state.success ? "done" : "editing"}>
      <FormError state={state} />
      {state.success && <FormMessage tone="success">Your password has been changed.</FormMessage>}

      <Field
        name="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
        state={state}
      />
      <Field
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        hint="At least 10 characters."
        state={state}
      />
      <Field
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        state={state}
      />

      <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
