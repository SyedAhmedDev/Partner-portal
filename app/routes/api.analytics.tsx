import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) return json({ success: false, error: "Unauthorized access" }, { status: 401 });

  try {
    // 1. Fetch Applications
    const appsResponse = await admin.graphql(`
      query {
        metaobjects(type: "brand_application", first: 250) {
          edges { node { fields { key value } } }
        }
      }
    `);
    
    // 2. Fetch Sponsorship Requests
    const sponsorshipsResponse = await admin.graphql(`
      query {
        metaobjects(type: "sponsorship_request", first: 250) {
          edges { node { fields { key value } } }
        }
      }
    `);

    const appsData = await appsResponse.json();
    const sponsorshipsData = await sponsorshipsResponse.json();

    // Process Applications
    let totalApplications = 0;
    let approvedApplications = 0;

    if (appsData.data?.metaobjects?.edges) {
      const edges = appsData.data.metaobjects.edges;
      totalApplications = edges.length;
      
      approvedApplications = edges.filter((edge: any) => {
        const statusField = edge.node.fields.find((f: any) => f.key === "status");
        return statusField && statusField.value.toLowerCase() === "approved";
      }).length;
    }

    // Process Sponsorship Pipeline
    let totalRequests = 0;
    let expectedRevenue = 0;
    let approvedRequests = 0;
    let approvedRevenue = 0;

    if (sponsorshipsData.data?.metaobjects?.edges) {
      const edges = sponsorshipsData.data.metaobjects.edges;
      totalRequests = edges.length;

      edges.forEach((edge: any) => {
        const fields = edge.node.fields;
        const statusField = fields.find((f: any) => f.key === "status");
        const rateField = fields.find((f: any) => f.key === "slot_rate");
        
        // Extract numeric value from rate (e.g. "$1,200" -> 1200)
        let rateValue = 0;
        if (rateField && rateField.value) {
          const cleanRate = rateField.value.replace(/[^0-9.]/g, '');
          rateValue = parseFloat(cleanRate) || 0;
        }

        // Add to Expected Revenue regardless of status
        expectedRevenue += rateValue;

        // If approved, add to Approved counts
        if (statusField && statusField.value === "Approved") {
          approvedRequests++;
          approvedRevenue += rateValue;
        }
      });
    }

    return json({
      success: true,
      totalApplications,
      approvedApplications,
      totalRequests,
      expectedRevenue,
      approvedRequests,
      approvedRevenue
    });

  } catch (error: any) {
    console.error("Analytics Error:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
}