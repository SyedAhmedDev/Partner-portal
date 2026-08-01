import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// =================================================================
// GET: Fetch the current stats to populate the admin form
// =================================================================
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) return json({ error: "Unauthorized" }, { status: 401 });

  try {
    const response = await admin.graphql(`
      query GetAudienceStats {
        metaobjectByHandle(handle: {type: "audience_statistics", handle: "master-stats"}) {
          id
          handle
          fields {
            key
            value
          }
        }
      }
    `);
    
    
    const data = await response.json();
    const metaobject = data.data?.metaobjectByHandle;

    let stats = {};
    
    // If the metaobject exists, format it into a simple key-value object
    if (metaobject && metaobject.fields) {
      stats = metaobject.fields.reduce((acc: any, field: any) => {
        acc[field.key] = field.value;
        return acc;
      }, {});
    }

    return json({ success: true, stats });
  } catch (error: any) {
    console.error("GET AUDIENCE STATS ERROR:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
}

// =================================================================
// POST: Create or Update the stats from the admin form
// =================================================================
export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) return json({ error: "Unauthorized" }, { status: 401 });

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();

    // Shopify Metaobjects require all values to be passed as strings.
    // We dynamically map the incoming JSON body into the exact format Shopify expects.
    const fields = Object.keys(body).map((key) => ({
      key: key,
      value: body[key] ? body[key].toString() : "0"
    }));

    const response = await admin.graphql(`
      mutation UpsertAudienceStats($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
        metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }
    `, {
      variables: {
        handle: { 
          type: "audience_statistics", 
          handle: "master-stats" 
        },
        metaobject: { 
          capabilities: { publishable: { status: "ACTIVE" } }, 
          fields: fields 
        }
      }
    });

    const data = await response.json();
    const errors = data.data?.metaobjectUpsert?.userErrors || [];
    
    if (errors.length > 0) {
      return json({ success: false, error: errors[0].message }, { status: 400 });
    }

    return json({ success: true, message: "Stats saved successfully!" });
  } catch (error: any) {
    console.error("UPSERT AUDIENCE STATS ERROR:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
}