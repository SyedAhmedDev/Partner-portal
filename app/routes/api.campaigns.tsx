import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) return json({ error: "Unauthorized" }, { status: 401 });

  try {
    // 1. Query customers tagged as partners to get their names/emails 
    // AND pull their connected campaign metaobjects in a single call.
    const response = await admin.graphql(`
      query {
        customers(first: 100, query: "tag:partner") {
          edges {
            node {
              firstName
              lastName
              email
              metafield(namespace: "custom", key: "partner_campaigns") {
                references(first: 50) {
                  edges {
                    node {
                      ... on Metaobject {
                        id
                        fields {
                          key
                          value
                          reference {
                            ... on GenericFile {
                              url
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);
    
    const data = await response.json();
    const campaigns: any[] = [];

    // 2. Map the nested data into the flat array expected by your frontend
    if (data.data?.customers?.edges) {
      data.data.customers.edges.forEach((customerEdge: any) => {
        const customer = customerEdge.node;
        const partnerName = `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || "Unknown Partner";
        const partnerEmail = customer.email || "No Email";
        
        // Check if this specific customer has connected campaigns
        const campaignReferences = customer.metafield?.references?.edges || [];

        campaignReferences.forEach((campEdge: any) => {
          const metaobject = campEdge.node;
          if (!metaobject || !metaobject.fields) return;

          // Helper to grab exact values or reference URLs
          const getField = (key: string) => metaobject.fields.find((f: any) => f.key === key)?.value || "-";
          const getReferenceUrl = (key: string) => metaobject.fields.find((f: any) => f.key === key)?.reference?.url || null;

          campaigns.push({
            id: metaobject.id,
            campaign_name: getField("campaign_name"),
            status: getField("status"),
            start_date: getField("start_date"),
            end_date: getField("end_date"),
            partner_name: partnerName,   // Securely injected from the parent Customer node
            partner_email: partnerEmail, // Securely injected from the parent Customer node
            invoice_url: getReferenceUrl("invoice_pdf")
          });
        });
      });
    }

    // 3. Sort campaigns so the most recently mapped appear at the top
    campaigns.reverse();

    return json(campaigns);
  } catch (error: any) {
    console.error("GET CAMPAIGNS ERROR:", error);
    return json({ error: error.message }, { status: 500 });
  }
}