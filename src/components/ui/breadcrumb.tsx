export type BreadcrumbItem = {
  label: string;
  href?: string;
};

// Breadcrumb navigation is intentionally disabled site-wide. Keeping this
// compatibility component lets detail pages shed the old path UI immediately
// without coupling the visual cleanup to every route's data-loading code.
export function Breadcrumb(props: {
  items: BreadcrumbItem[];
  label?: string;
  className?: string;
}) {
  void props;
  return null;
}
