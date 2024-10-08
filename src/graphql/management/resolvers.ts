  import { jwtsecret } from "../..";
  import { prisma } from "../../db";
  import bcrypt from "bcrypt";
  import jwt from "jsonwebtoken";
  import { SaleType as PrismaSaleType } from "@prisma/client";

  // Hash the password asynchronously
  async function hashPassword(plainPassword: string) {
    const saltRounds = 10;
    const salt = await bcrypt.genSalt(saltRounds);
    const hash = await bcrypt.hash(plainPassword, salt);
    return hash;
  }

  interface SalesDetail {
    productId: string;
    quantitySold: number;
  }
  interface Product {
    productId: string;
    productName: string;
    description: string;
    costPrice: number;
    sellingPrice: number;
    offerPrice: number;
    expiry?: string; // GraphQL type is String, so we use string | undefined
    batchId: string;
    manufactureDate?: string; // GraphQL type is String, so we use string | undefined
    categoryName: string;
    weight: number;
    images: string[];
    customerRating?: number; // GraphQL type is Float, so we use number | undefined
    offerPercentage: number;
    quantity?: number; // GraphQL type is Float, so we use number | undefined
  }

  // Fetch product details and calculate the total amount
  // Fetch product details and calculate the total amount
  // Fetch product details and calculate the total amount
  const fetchProductDetailsAndCalculateTotalAmount = async (
    salesDetails: SalesDetail[]
  ) => {
    // Collect product IDs from sales details
    const productIds = salesDetails.map((detail) => detail.productId);

    // Fetch products from database
    const fetchedProducts = await prisma.product.findMany({
      where: {
        productId: { in: productIds },
      },
      select: {
        productId: true,
        offerPrice: true, // This is the price to use for calculation
      },
    });

    // Map product IDs to their offer price
    const productIdToOfferPrice = fetchedProducts.reduce((map, product) => {
      map[product.productId] = product.offerPrice;
      return map;
    }, {} as Record<string, number>);

    // Calculate total amount using `offerPrice` from fetched products
    const totalAmount = salesDetails.reduce((total, detail) => {
      const offerPrice = productIdToOfferPrice[detail.productId];

      if (offerPrice === undefined) {
        throw new Error(`Offer price for product ID ${detail.productId} not found`);
      }

      return total + offerPrice * detail.quantitySold;
    }, 0);

    return totalAmount;
  };



  // GraphQL Queries
  const queries = {
    customer: async (_: any, { userId }: { userId: string }) => {
      try {
        const customer = await prisma.customer.findUnique({
          where: { customerId: userId },
        });

        if (!customer) {
          throw new Error("Customer not found");
        }

        return customer;
      } catch (error) {
        console.error("Error fetching customer:", error);
        throw new Error("Unable to fetch customer");
      }
    },
    product: async (_: any, { productId }: { productId: string }) => {
      try {
        const product = await prisma.product.findUnique({
          where: { productId: productId },
        });

        if (!product) {
          throw new Error("Product not found");
        }

        return product;
      } catch (error) {
        console.error("Error fetching product:", error);
        throw new Error("Unable to fetch product");
      }
    },

    salesLength: async (_: any, __: any, { user }: any) => {
      try {
        const salesCount = await prisma.sale.count({
          where: { customerId: user.userId },
        });
        return salesCount;
      } catch (error) {
        console.error("Error fetching sales count:", error);
        throw new Error("Unable to fetch sales count");
      }
    },

    customers: async (_: any, __: any, { user }: any) => {
      if (!user) throw new Error("Not authenticated");
      return await prisma.customer.findMany({
        where: { customerId: user.userId },
      });
    },

    products: async (_: any, __: any, { user }: any) => {
      if (!user) throw new Error("Not authenticated");
      return await prisma.product.findMany({
        where: { customerId: user.userId },
      });
    },

    sales: async (_: any, __: any, { user }: any) => {
      if (!user) throw new Error("Not authenticated");

      return await prisma.sale.findMany({
        where: { customerId: user.userId },
        include: {
          salesDetails: true, // This ensures that salesDetails are fetched with each sale
        },
      });
    },

    validateToken: async (_: any, { token }: { token: string }) => {
      try {
        const decoded = jwt.verify(token, jwtsecret) as { userId: string };

        const customer = await prisma.customer.findUnique({
          where: { customerId: decoded.userId },
        });

        // Handle the case where the user does not exist
        if (!customer) {
          return {
            valid: false,
            message: "Token is valid, but customer does not exist",
            user: null, // Ensure `user` is null if customer does not exist
          };
        }

        return {
          valid: true,
          message: "Token is valid",
          user: customer,
        };
      } catch (error) {
        console.error("Error validating token:", error);
        return {
          valid: false,
          message: "Token is invalid",
          user: null, // Ensure `user` is null if token is invalid
        };
      }
    },
  };

  enum Gender {
    MALE = "MALE",
    FEMALE = "FEMALE",
    PREFER_NOT_TO_SAY = "PREFER_NOT_TO_SAY",
  }

  const mutations = {
    createCustomer: async (
      parent: any,
      args: { gender: Gender; name: string; password: string; email: string },
      context: any
    ) => {
      try {
        const hashedPassword = await hashPassword(args.password);
        const newCustomer = await prisma.customer.create({
          data: {
            gender: args.gender,
            name: args.name,
            password: hashedPassword,
            email: args.email,
          },
        });

        const { password, ...customerWithoutPassword } = newCustomer;
        const token = jwt.sign({ userId: newCustomer.customerId }, jwtsecret, {
          expiresIn: "1h",
        });

        context.res.cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          maxAge: 3600000,
        });

        return {
          token,
          customer: customerWithoutPassword,
          message: "Registration successful",
        };
      } catch (error) {
        console.error("Error creating customer:", error);
        throw new Error("Unable to create customer");
      }
    },

    login: async (
      _: any,
      { email, password }: { email: string; password: string },
      context: any
    ) => {
      try {
        const user = await prisma.customer.findUnique({
          where: { email },
        });

        if (!user) {
          throw new Error("User not found");
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
          throw new Error("Invalid password");
        }

        const token = jwt.sign({ userId: user.customerId }, jwtsecret, {
          expiresIn: "1h",
        });

        context.res.cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          maxAge: 3600000,
        });

        return { user, token, message: "Login successful" };
      } catch (error) {
        console.error("Error during login:", error);
        throw new Error("Unable to login");
      }
    },

    createProduct: async (
      parent: any,
      args: {
        productName: string;
        description: string;
        costPrice: number;
        expiry?: string; // Change Date to string for input type
        manufactureDate?: string; // Change Date to string for input type
        sellingPrice: number;
        batchId: string;
        categoryName: string;
        weight: number;
        images: string[];
        customerRating?: number;
        offerPercentage: number;
        quantity: number;
      },
      context: any
    ) => {
      if (!context.user) throw new Error("Not authenticated");

      const offerPrice = args.sellingPrice * (1 - args.offerPercentage / 100);
      const productData: any = {
        productName: args.productName,
        description: args.description,
        costPrice: args.costPrice,
        sellingPrice: args.sellingPrice,
        offerPrice: offerPrice || 0,
        expiry: args.expiry ? new Date(args.expiry) : null,
        batchId: args.batchId,
        manufactureDate: args.manufactureDate
          ? new Date(args.manufactureDate)
          : null,
        categoryName: args.categoryName,
        weight: args.weight,
        images: args.images || [],
        customerRating: args.customerRating || null,
        offerPercentage: args.offerPercentage || 0,
        quantity: args.quantity,
        customer: {
          connect: {
            customerId: context.user.userId, // Connect using the customerId from context
          },
        },
      };

      return await prisma.product.create({
        data: productData,
      });
    },

   

    createSale: async (
      _: any,
      args: {
        cumulativeDiscount: number;
        freightPrice: number;
        storeId: string;
        address: string;
        userId: string;
        paymentType: string;
        saleType: PrismaSaleType;
        salesDetails: {
          productId: string;
          quantitySold: number;
        }[];
      },
      context: any
    ) => {
      // Optional: Remove authentication check if not needed
      // if (!context.user) throw new Error("Not authenticated");
    
      // Extract product IDs from salesDetails
      const productIds = args.salesDetails.map((detail) => detail.productId);
    
      // Fetch product details from the database
      const fetchedProducts = await prisma.product.findMany({
        where: {
          productId: { in: productIds },
        },
        select: {
          productId: true,
          offerPrice: true, // Use this for calculation
          customerId: true,
        },
      });
    
      // Map product IDs to their offer price and customerId
      const productIdToDetails = fetchedProducts.reduce((map, product) => {
        map[product.productId] = { offerPrice: product.offerPrice, customerId: product.customerId };
        return map;
      }, {} as Record<string, { offerPrice: number; customerId: string }>);
    
      // Verify that all products have associated customerIds
      const allCustomerIdsExist = args.salesDetails.every((detail) =>
        productIdToDetails.hasOwnProperty(detail.productId)
      );
      if (!allCustomerIdsExist) {
        throw new Error("Some products do not have associated customerIds");
      }
    
      // Calculate the total amount using offerPrice from fetched products
      const totalAmount = args.salesDetails.reduce((total, detail) => {
        const productDetails = productIdToDetails[detail.productId];
        if (!productDetails) {
          throw new Error(`Product with ID ${detail.productId} not found`);
        }
        return total + productDetails.offerPrice * detail.quantitySold;
      }, 0);
    
      // Create a new sale entry in the database
      const sale = await prisma.sale.create({
        data: {
          userId: args.userId,
          totalAmount: totalAmount,
          cumulativeDiscount: args.cumulativeDiscount,
          freightPrice: args.freightPrice,
          storeId: args.storeId,
          address: args.address,
          customerId: productIdToDetails[args.salesDetails[0].productId].customerId, // Use customerId from the first product
          paymentType: args.paymentType,
          saleType: args.saleType,
          saleDate: new Date(),
          salesDetails: {
            create: args.salesDetails.map((detail) => {
              const productDetails = productIdToDetails[detail.productId];
              if (!productDetails) {
                throw new Error(`Product details for ID ${detail.productId} not found`);
              }
              return {
                productId: detail.productId,
                quantitySold: detail.quantitySold,
                sellingPrice: productDetails.offerPrice, // Include the fetched sellingPrice
              };
            }),
          },
        },
        include: {
          salesDetails: true,
        },
      });
    
      return sale;
    }
    
    ,

    createCompetitorPrice: async (
      parent: any,
      args: {
        productId: string;
        companyName: string;
        price: number;
        freight: number;
        customerRating: number;
      }
    ) => {
      return await prisma.competitorPrice.create({
        data: {
          productId: args.productId,
          companyName: args.companyName,
          price: args.price,
          freight: args.freight,
          customerRating: args.customerRating,
        },
      });
    },
    createPriceHistory: async (
      _: any,
      { productId, price, offerPercentage }: { productId: string; price: number; offerPercentage: number }
    ) => {
      return prisma.priceHistory.create({
        data: {
          productId,
          price,
          date: new Date(),
          offerPercentage,
        },
      });
    },


    // Update Product Function
    updateProduct: async (
      _: any,
      args: {
        productId: string;
        sellingPrice?: number;
        offerPercentage?: number;
      },
      context: any
    ) => {
      // if (!context.user) return null; // Return null if the user is not authenticated
    
      // Fetch the existing product
      const existingProduct = await prisma.product.findUnique({
        where: { productId: args.productId },
      });
    
      // Return null if the product is not found
      if (!existingProduct) {
        // console.warn(`Product not found for ID: ${args.productId}`);
        return null;
      }
      // console.log(existingProduct);
      
    
      // Use existing values if not provided
      const newSellingPrice = args.sellingPrice ?? existingProduct.sellingPrice;
      const newOfferPercentage = args.offerPercentage ?? existingProduct.offerPercentage;
    
      // Ensure that newOfferPercentage is a number
      const offerPercentage = newOfferPercentage ?? 0; // Fallback to 0 if null
    
      // Calculate new offer price
      const newOfferPrice = newSellingPrice * (1 - offerPercentage / 100);
    
      // Store the price history only if there are changes
      if (existingProduct.sellingPrice !== newSellingPrice || existingProduct.offerPercentage !== offerPercentage) {
        await prisma.priceHistory.create({
          data: {
            price: existingProduct.sellingPrice,
            date: new Date(), // The date when the price was active
            productId: existingProduct.productId,
            offerPercentage: existingProduct.offerPercentage?existingProduct.offerPercentage:0, // Store the previous offer percentage
          },
        }).catch((error) => {
          console.error("Error creating price history:", error);
        });
      }
    
      // Update the product
      try {
        const updatedProduct = await prisma.product.update({
          where: { productId: args.productId },
          data: {
            sellingPrice: newSellingPrice,
            offerPercentage: offerPercentage, // Use the validated offer percentage
            offerPrice: newOfferPrice, // newOfferPrice is guaranteed to be a number
          },
        });
        return updatedProduct;
      } catch (error) {
        console.error("Error updating product:", error);
        return null;
      }
    }

  };

  export const resolvers = { queries, mutations };
