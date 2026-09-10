/**
 * Frozen Ocean Sofa hub graph fixture for mapper unit tests.
 * No network — static shapes only.
 */
import type { HubProductGraph } from "@/mappers/types";

export const OCEAN_SOFA_GRAPH: HubProductGraph = {
  rootSku: "FIN-OCN-SOF-96X38",
  skus: [
    {
      globalSku: "RM-MET-EXT-2X2",
      itemType: "raw_material",
      originalName: "Aluminum Extrusion 2x2",
      category: "Metal",
      uomPurchase: "ft",
      baseCost: "4.25",
      katanaVariantId: 1001,
    },
    {
      globalSku: "RM-FAB-GENERIC",
      itemType: "raw_material",
      originalName: "Generic Outdoor Fabric",
      category: "Fabric",
      uomPurchase: "yd",
      baseCost: "12.00",
      katanaVariantId: 1002,
    },
    {
      globalSku: "SA-OCN-SOF-FRAME",
      itemType: "sub_assembly",
      originalName: "Ocean Sofa Frame",
      category: "Furniture",
      uomConsume: "ea",
      katanaVariantId: 2001,
    },
    {
      globalSku: "SA-OCN-SOF-CUSH",
      itemType: "sub_assembly",
      originalName: "Ocean Sofa Cushion",
      category: "Furniture",
      uomConsume: "ea",
      katanaVariantId: 2002,
    },
    {
      globalSku: "FIN-OCN-SOF-96X38",
      itemType: "finished_good",
      originalName: "Ocean Sofa 96x38",
      category: "Furniture",
      uomConsume: "ea",
      katanaVariantId: 3001,
    },
  ],
  edges: [
    {
      parentSku: "SA-OCN-SOF-FRAME",
      childSku: "RM-MET-EXT-2X2",
      quantity: 24,
      scrapFactor: 1.05,
      unitOfMeasure: "ft",
    },
    {
      parentSku: "SA-OCN-SOF-CUSH",
      childSku: "RM-FAB-GENERIC",
      quantity: 6,
      scrapFactor: 1.1,
      unitOfMeasure: "yd",
    },
    {
      parentSku: "FIN-OCN-SOF-96X38",
      childSku: "SA-OCN-SOF-FRAME",
      quantity: 1,
      scrapFactor: 1,
      unitOfMeasure: "ea",
    },
    {
      parentSku: "FIN-OCN-SOF-96X38",
      childSku: "SA-OCN-SOF-CUSH",
      quantity: 1,
      scrapFactor: 1,
      unitOfMeasure: "ea",
    },
  ],
  operations: [
    {
      itemSku: "SA-OCN-SOF-FRAME",
      workCenter: "Welding",
      sequence: 10,
      setupTimeMins: 15,
      runTimeMins: 45,
    },
    {
      itemSku: "FIN-OCN-SOF-96X38",
      workCenter: "Final Assembly",
      sequence: 10,
      setupTimeMins: 5,
      runTimeMins: 20,
    },
  ],
  commerce: {
    globalSku: "FIN-OCN-SOF-96X38",
    name: "Ocean Sofa 96x38",
    msrp: "4,850.00",
    cost: "1,200.00",
    description: "Fully welded aluminum outdoor sofa",
    imageUrl: "https://cdn.example.com/ocean-sofa.jpg",
    slug: "ocean-sofa-96x38",
    seoTitle: "Ocean Sofa 96x38 | CC Patio",
    seoDescription: "Luxury fully-welded outdoor sofa with wood-grain finish.",
    syncToWoo: true,
    syncToClover: true,
  },
};
