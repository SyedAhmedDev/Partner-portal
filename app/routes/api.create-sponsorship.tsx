import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { admin } = await authenticate.public.appProxy(request);
    if (!admin) return json({ success: false, error: "Unauthorized" }, { status: 401 });

    const body = await request.json();

    // 1. Parse the placements and rate
    const placementsArray = JSON.parse(body.placementType); 
    const ratesString = body.rate; 

    // 2. Handle Image Upload to Shopify Files (Staged Uploads)
    let uploadedFileId = null;

    if (body.fileData && body.fileName && body.mimeType) {
      try {
        // A. Request Staged Upload URL
        const stageRes = await admin.graphql(`
          mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
              stagedTargets {
                url
                resourceUrl
                parameters { name value }
              }
            }
          }
        `, {
          variables: {
            input: [{
              filename: body.fileName,
              mimeType: body.mimeType,
              resource: "IMAGE",
              httpMethod: "POST"
            }]
          }
        });

        const stageData: any = await stageRes.json();
        const target = stageData.data.stagedUploadsCreate.stagedTargets[0];

        // B. Upload file to Shopify's AWS staging bucket
        const formData = new FormData();
        target.parameters.forEach((p: any) => formData.append(p.name, p.value));

        // Convert base64 data to a Blob for uploading
        const buffer = Buffer.from(body.fileData, 'base64');
        const blob = new Blob([buffer], { type: body.mimeType });
        formData.append('file', blob);

        const awsRes = await fetch(target.url, { method: 'POST', body: formData });

        // C. Create the File inside Shopify admin
        if (awsRes.ok) {
          const fileCreateRes = await admin.graphql(`
            mutation fileCreate($files: [FileCreateInput!]!) {
              fileCreate(files: $files) {
                files { id }
                userErrors { message }
              }
            }
          `, {
            variables: {
              files: [{
                alt: body.title,
                contentType: "IMAGE",
                originalSource: target.resourceUrl
              }]
            }
          });

          const fileData: any = await fileCreateRes.json();
          if (fileData.data?.fileCreate?.files?.length > 0) {
            uploadedFileId = fileData.data.fileCreate.files[0].id;
          }
        }
      } catch (uploadError) {
        console.error("Image Upload Error:", uploadError);
      }
    }

    // 3. Build the Metaobject fields array dynamically
    const metaobjectFields: any[] = [
      { key: "title", value: body.title },
      { key: "description", value: body.description },
      { key: "specs", value: body.specs },
      { key: "placement_type", value: JSON.stringify(placementsArray) },
      { key: "inventory_status", value: JSON.stringify([body.status]) }, 
      { key: "rate", value: ratesString } 
    ];

    // Handle the new discount fields
    if (body.discountType && body.discountValue) {
      metaobjectFields.push({ key: "discount_type", value: body.discountType });
      // Ensure the value is converted to a string for the GraphQL MetaobjectFieldInput
      metaobjectFields.push({ key: "discount_value", value: body.discountValue.toString() });
    }

    // If the image uploaded successfully, attach its Shopify ID to the Metaobject
    if (uploadedFileId) {
      metaobjectFields.push({ key: "thumbnail", value: uploadedFileId });
    }

    // 4. Send the Mutation to Shopify
    const response = await admin.graphql(`
      mutation CreateSponsorshipSlot($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }
    `, {
      variables: {
        metaobject: {
          type: "sponsorship_slot",
          // ADD THIS BLOCK TO FORCE "ACTIVE" STATUS
          capabilities: {
            publishable: {
              status: "ACTIVE"
            }
          },
          fields: metaobjectFields
        }
      }
    });

    const data: any = await response.json();
    const errors = data?.data?.metaobjectCreate?.userErrors;

    if (errors?.length > 0) {
      return json({ success: false, error: errors[0].message });
    }

    return json({ success: true });

  } catch (error: any) {
    console.error("Create Slot Error:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
}