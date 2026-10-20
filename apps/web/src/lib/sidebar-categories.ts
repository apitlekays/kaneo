// Static, business-domain sidebar categories shown between "Overview" and
// "Projects". Each sub-item currently routes to a shared coming-soon view
// (`/dashboard/category/<slug>`); wiring a real page later is just swapping the
// route component for the matching slug.

export type SidebarCategoryItem = {
  slug: string;
  titleKey: string;
};

export type SidebarCategory = {
  titleKey: string;
  items: SidebarCategoryItem[];
};

export const SIDEBAR_CATEGORIES: SidebarCategory[] = [
  {
    titleKey: "navigation:sidebar.categories.operations",
    items: [
      {
        slug: "general-management",
        titleKey: "navigation:sidebar.categories.generalManagement",
      },
      {
        slug: "human-resources",
        titleKey: "navigation:sidebar.categories.humanResources",
      },
      {
        slug: "legal-compliances",
        titleKey: "navigation:sidebar.categories.legalCompliances",
      },
      {
        slug: "information-technology",
        titleKey: "navigation:sidebar.categories.informationTechnology",
      },
      {
        slug: "assets-management",
        titleKey: "navigation:sidebar.categories.assetsManagement",
      },
    ],
  },
  {
    titleKey: "navigation:sidebar.categories.revenue",
    items: [
      {
        slug: "marketing",
        titleKey: "navigation:sidebar.categories.marketing",
      },
      { slug: "sales", titleKey: "navigation:sidebar.categories.sales" },
      {
        slug: "customer-service",
        titleKey: "navigation:sidebar.categories.customerService",
      },
    ],
  },
  {
    titleKey: "navigation:sidebar.categories.finance",
    items: [
      {
        slug: "finance-accounting",
        titleKey: "navigation:sidebar.categories.financeAccounting",
      },
    ],
  },
];

// The access matrix's column groups: the Consultations section (which is
// not a category page, but is gated the same way) and then every category.
export const ACCESS_PAGE_GROUPS: SidebarCategory[] = [
  {
    titleKey: "navigation:sidebar.overview",
    items: [
      {
        slug: "consultations",
        titleKey: "navigation:sidebar.consultations",
      },
    ],
  },
  ...SIDEBAR_CATEGORIES,
];

// Flat list of every gateable page slug, in matrix order. MUST stay in sync
// with ACCESS_PAGE_SLUGS in apps/api/src/workspace-access/index.ts.
export const ALL_CATEGORY_SLUGS = ACCESS_PAGE_GROUPS.flatMap((category) =>
  category.items.map((item) => item.slug),
);

export function categoryItemPath(slug: string) {
  return `/dashboard/category/${slug}`;
}

export function findCategoryItem(slug: string) {
  for (const category of SIDEBAR_CATEGORIES) {
    const item = category.items.find((candidate) => candidate.slug === slug);
    if (item) return { category, item };
  }
  return null;
}
