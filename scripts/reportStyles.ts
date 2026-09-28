/** Typography for TinyMCE HTML (exec summary, comments, key messages) in print pages. */
export const RICH_HTML_CLASSES = [
  'text-[11px] leading-relaxed text-slate-800 break-words',
  '[&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-[#00205B]',
  '[&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:border-b [&_h2]:pb-0.5 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-[#00205B]',
  '[&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-slate-800',
  '[&_p]:mb-2',
  '[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5',
  '[&_blockquote]:my-2 [&_blockquote]:rounded-r [&_blockquote]:border-l-4 [&_blockquote]:border-[#00205B] [&_blockquote]:bg-slate-50 [&_blockquote]:p-2',
  '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[10px]',
  '[&_thead_tr]:bg-[#00205B] [&_th]:border [&_th]:border-slate-300 [&_th]:bg-[#00205B] [&_th]:p-1.5 [&_th]:text-left [&_th]:text-white',
  '[&_td]:border [&_td]:border-slate-300 [&_td]:p-1.5 [&_td]:align-top',
  '[&_code]:rounded [&_code]:border [&_code]:bg-slate-50 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[10px]',
  '[&_a]:font-medium [&_a]:text-[#0055c8] [&_a]:underline',
  '[&_hr]:my-3 [&_hr]:border-slate-200',
  '[&_img]:my-1 [&_img]:h-auto [&_img]:max-w-full',
].join(' ');
