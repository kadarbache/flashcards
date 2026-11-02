/**
 * The watch screen's layout, shared with its loading skeleton so nothing jumps
 * when the page arrives. The page marks itself `data-wide` to use the whole
 * window instead of the usual centred column.
 *
 * From `xl` up it is laid out like YouTube: a big video, the transcript in a
 * column on the right that ends where the video does, and the title under the
 * video. The video is as wide as the window allows while its height still fits
 * under the header (the `100dvh - 8rem`). Below `xl` everything stacks.
 */

export const watchGrid =
  "grid grid-cols-1 gap-x-6 gap-y-4 xl:grid-cols-[minmax(0,calc((100dvh_-_8rem)_*_16_/_9))_25rem] xl:justify-center";

export const videoFrame =
  "relative mx-auto aspect-video w-full max-w-[calc((100dvh_-_8rem)_*_16_/_9)] overflow-hidden rounded-3xl xl:col-start-1 xl:row-start-1";

/**
 * Holds the transcript's place in the grid without a height of its own, so the
 * row is exactly as tall as the video and the panel fills it.
 */
export const transcriptSlot = "xl:relative xl:col-start-2 xl:row-start-1";

export const transcriptPanel = "flex flex-col gap-3 rounded-3xl bg-surface-raised xl:absolute xl:inset-0";
