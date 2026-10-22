import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function action({ request }: { request: Request }) {
  // 1. Authenticate the request and get the admin client
  const { admin } = await authenticate.public.appProxy(request);

  // Note: authenticate.public.appProxy(request) returns the admin client
  // if your shopify.server.ts is configured correctly.
  // If 'admin' is still undefined, you may need to initialize it manually.

  // 2. Parse the JSON from the frontend
  const data = await request.json();

  // 3. Define the GraphQL Mutation
  const mutation = `
    mutation createSponsorshipRequest($input: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $input) {
        metaobject {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // 4. Map payload
  const input = {
    type: "sponsorship_request",
    capabilities: {
      publishable: {
        status: "ACTIVE",
      },
    },
    fields: [
      { key: "slot_id", value: data.slot_id },
      { key: "slot_title", value: data.slot_title },
      // ... other fields
      { key: "slot_rate", value: data.slot_rate },
      { key: "slot_placement", value: data.slot_placement },
      { key: "slot_thumbnail", value: data.slot_thumbnail },
      { key: "message", value: typeof data.message === "string" ? data.message : "" },
      { key: "partner_name", value: data.partner_name },
      { key: "partner_email", value: data.partner_email },
      { key: "status", value: data.status },
    ],
  };

  try {
    // 5. Use the admin client to execute the mutation
    if (!admin) {
      return json({ success: false, error: "Admin client not available" });
    }

    const response = await admin.graphql(mutation, { variables: { input } });
    const result = await response.json();

    if (result.data?.metaobjectCreate?.userErrors?.length > 0) {
      return json({
        success: false,
        error: result.data.metaobjectCreate.userErrors[0].message,
      });
    }

    return json({ success: true });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return json({ success: false, error: errorMessage });
  }
}
